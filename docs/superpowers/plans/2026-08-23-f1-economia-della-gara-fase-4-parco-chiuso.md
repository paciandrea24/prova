# F1 — Economia della gara, fase 4: il parco chiuso — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In stagione la macchina smette di rinascere ad ogni gara: fondo, motore e sospensioni si trascinano da un weekend al successivo, e fra una gara e l'altra si decide cosa sostituire sapendo che costa posizioni in griglia.

**Architecture:** Nessun nuovo posto dove vive lo stato. Il documento della stagione registra **eventi** (l'usura alla bandiera, i ricambi decisi dopo), e lo stato attuale della vettura è una funzione pura che rigioca la lista — lo stesso principio già scritto in `f1Stagione.js` per la classifica. L'officina non è un momento ma uno **stato derivato**: «questa stagione è fra due gare e per la gara N non risulta una decisione».

**Tech Stack:** Node.js (CommonJS), `node:test` + `node:assert/strict`, Express, MongoDB via `seasonStore`. Frontend JS vanilla. Nessuna dipendenza nuova.

**Spec:** `docs/superpowers/specs/2026-08-23-f1-economia-della-gara-design.md` (sezioni «Il parco chiuso», «Il documento della stagione», «La penalità in griglia», «I bot»)

## Global Constraints

- **Italiano** nei commenti e nei messaggi di commit.
- **Un commit per task.** Il push lo fa l'utente, mai l'agente.
- **`git add` per nome, MAI `git add -A`.** L'utente lavora in parallelo su `frontend/f1.js|html`, `frontend/styles/f1.css` e `frontend/tracks/*.json`. Se un task deve toccare un file che l'utente ha già modificato, si mette in staging **solo il proprio lavoro**: `git diff <file> > utente.patch` PRIMA di editare, poi `git add <file>` e `git apply --cached -R utente.patch`, e si controlla con `git diff --cached` prima di committare.
- **Branch**: `f1-stagioni`.
- **Cache-busting**: modificare `frontend/f1.js` o `frontend/shared/f1StagioneSchermate.js` richiede di alzare il rispettivo `?v=` in `frontend/f1.html`.
- **I modelli fisici non sanno che le stagioni esistono.** Nessuna funzione in `physics/` deve ricevere il formato della sessione. Questo vincolo è già rispettato dalle fasi 1-3 e non va infranto qui.
- **Le regole del campionato stanno in `frontend/shared/f1Stagione.js`**, che gira identico su client e server. Sono pure: niente I/O, niente `Date.now()` implicito (si passa `adesso`), nessuna mutazione dell'input.
- **Test**: `node --test backend/` dalla radice. `npm test` non esiste.
- ⚠️ **La suite ha 9 rossi PREESISTENTI**, uno dei quali (`prova-notturno: i bot entrano davvero in corsia box`) è **intermittente**. Registrare l'elenco all'inizio con `node --test backend/ 2>&1 | grep "^not ok"` e confrontarlo alla fine: il criterio è **«nessun rosso NUOVO»**, non «tutto verde». Un rosso che compare e sparisce fra due esecuzioni è quello lì.
- **Prerequisito**: fasi 1-3 committate (da `e635c75` a `d57a55a`) e playtestate.

---

### Task 1: L'usura entra nei risultati, e lo stato si calcola

Il primo mattone, tutto dentro le regole pure. Un risultato di gara smette di essere solo un ordine d'arrivo: porta con sé com'era ridotta ogni macchina alla bandiera.

**Files:**
- Modify: `frontend/shared/f1Stagione.js` (`registraRisultato`, più funzioni nuove)
- Test: `frontend/shared/f1Stagione.test.js`

**Interfaces:**
- Consumes: niente.
- Produces:
  - `registraRisultato(stagione, { ordine, usura, adesso })` — `usura` è `{ [idPilota]: { frontWing, floor, engine, suspension } }`, facoltativo (assente = nessuna usura registrata)
  - `COMPONENTI` (array `['frontWing', 'floor', 'engine', 'suspension']`)
  - `COMPONENTI_PARCO_CHIUSO` (array `['floor', 'engine', 'suspension']`)
  - `statoVettura(stagione, idPilota) -> { frontWing, floor, engine, suspension }`

- [ ] **Step 1: Registrare i rossi preesistenti**

Run: `node --test backend/ 2>&1 | grep "^not ok"`

Salvare l'output. Attesi 9 (uno intermittente). Se ce ne sono di più, FERMARSI e segnalarlo.

- [ ] **Step 2: Scrivere i test che falliscono**

Aggiungere in fondo a `frontend/shared/f1Stagione.test.js`:

```js
// ---- Il parco chiuso: lo stato della vettura si CALCOLA ---------------------
// Stesso principio già scritto sopra per la classifica: nel documento stanno
// gli EVENTI, non i totali. Un'usura salvata accanto agli eventi sarebbe un
// secondo posto dove vive la stessa verità.
// Rif. docs/superpowers/specs/2026-08-23-f1-economia-della-gara-design.md

function stagioneDaDueGare() {
    return F1Stagione.creaStagione({
        nome: 'Parco chiuso', creataDa: 'uid-a',
        piloti: [{ uid: 'uid-a', colore: 'red' }, { colore: 'blue', bot: true }],
        calendario: ['prova', 'new-monza', 'monte-rosso'],
        adesso: '2026-08-23T00:00:00.000Z',
    });
}

test('statoVettura: prima di ogni gara la macchina e\' nuova', () => {
    const s = stagioneDaDueGare();
    assert.deepEqual(F1Stagione.statoVettura(s, 'p1'),
        { frontWing: 0, floor: 0, engine: 0, suspension: 0 });
});

test('statoVettura: dopo una gara porta l\'usura di quella gara', () => {
    let s = stagioneDaDueGare();
    s = F1Stagione.registraRisultato(s, {
        ordine: ['p1', 'p2'],
        usura: { p1: { frontWing: 40, floor: 12, engine: 35, suspension: 3 } },
        adesso: '2026-08-23T01:00:00.000Z',
    });
    assert.deepEqual(F1Stagione.statoVettura(s, 'p1'),
        { frontWing: 40, floor: 12, engine: 35, suspension: 3 });
});

test('statoVettura: l\'ultima gara registrata e\' quella che conta, non la somma', () => {
    // L'usura salvata e' gia' il TOTALE alla bandiera, non l'incremento di
    // quella gara: sommarla la conterebbe due volte.
    let s = stagioneDaDueGare();
    s = F1Stagione.registraRisultato(s, {
        ordine: ['p1', 'p2'],
        usura: { p1: { frontWing: 40, floor: 12, engine: 35, suspension: 3 } },
    });
    s = F1Stagione.registraRisultato(s, {
        ordine: ['p1', 'p2'],
        usura: { p1: { frontWing: 10, floor: 20, engine: 70, suspension: 5 } },
    });
    assert.deepEqual(F1Stagione.statoVettura(s, 'p1'),
        { frontWing: 10, floor: 20, engine: 70, suspension: 5 });
});

test('statoVettura: un pilota senza usura registrata resta a zero', () => {
    // Il bot p2 non compare nella mappa: non e' un errore, e' una gara
    // registrata da una versione che l'usura non la scriveva.
    let s = stagioneDaDueGare();
    s = F1Stagione.registraRisultato(s, {
        ordine: ['p1', 'p2'],
        usura: { p1: { frontWing: 40, floor: 12, engine: 35, suspension: 3 } },
    });
    assert.deepEqual(F1Stagione.statoVettura(s, 'p2'),
        { frontWing: 0, floor: 0, engine: 0, suspension: 0 });
});

test('registraRisultato: non muta la stagione che riceve', () => {
    const s = stagioneDaDueGare();
    F1Stagione.registraRisultato(s, { ordine: ['p1', 'p2'], usura: { p1: { engine: 50 } } });
    assert.equal(s.risultati.length, 0, 'l\'originale non si tocca');
});

test('statoVettura: valori fuori scala vengono limitati a 0-100', () => {
    let s = stagioneDaDueGare();
    s = F1Stagione.registraRisultato(s, {
        ordine: ['p1', 'p2'],
        usura: { p1: { frontWing: -5, floor: 250, engine: NaN, suspension: 3 } },
    });
    assert.deepEqual(F1Stagione.statoVettura(s, 'p1'),
        { frontWing: 0, floor: 100, engine: 0, suspension: 3 });
});
```

Se il file non ha già `F1Stagione` importato come oggetto intero, aggiungere in cima `const F1Stagione = require('./f1Stagione.js');`.

- [ ] **Step 3: Eseguire i test e verificare che falliscano**

Run: `node --test frontend/shared/f1Stagione.test.js`
Expected: FAIL — `F1Stagione.statoVettura is not a function`.

- [ ] **Step 4: Scrivere le regole**

In `frontend/shared/f1Stagione.js`, dentro la factory, prima di `registraRisultato`:

```js
    // ---- il parco chiuso ----------------------------------------------------
    //
    // Come per la classifica: nel documento stanno gli EVENTI, non i totali.
    // Un'usura salvata accanto agli eventi sarebbe un secondo posto dove vive
    // la stessa verita', e i due prima o poi divergono. Rif.
    // docs/superpowers/specs/2026-08-23-f1-economia-della-gara-design.md.
    const COMPONENTI = ['frontWing', 'floor', 'engine', 'suspension'];

    // L'ala anteriore NON e' del parco chiuso: e' nuova ad ogni via e si cambia
    // ai box. Le altre tre si trascinano, e sono le uniche che l'officina puo'
    // sostituire.
    const COMPONENTI_PARCO_CHIUSO = ['floor', 'engine', 'suspension'];

    function vetturaNuova() {
        return { frontWing: 0, floor: 0, engine: 0, suspension: 0 };
    }

    // 0-100, e mai NaN: questi numeri arrivano dal server e finiscono nella
    // fisica, dove un NaN non si ferma piu' (stessa trappola documentata in
    // TyreModel.getWearPenaltyFactor).
    function percentuale(v) {
        const n = Number(v);
        if (!Number.isFinite(n)) return 0;
        return Math.max(0, Math.min(100, n));
    }

    function normalizzaUsura(grezza) {
        const out = vetturaNuova();
        if (!grezza) return out;
        for (const c of COMPONENTI) out[c] = percentuale(grezza[c]);
        return out;
    }

    // Com'e' ridotta la macchina di questo pilota ADESSO.
    //
    // L'usura registrata e' gia' il TOTALE alla bandiera, non l'incremento di
    // quella gara: si prende l'ULTIMA, non si somma. Sommare la conterebbe due
    // volte, e dopo tre gare la macchina sarebbe distrutta senza motivo.
    //
    // I ricambi decisi in officina azzerano il loro componente, e vengono
    // applicati DOPO l'usura della gara a cui sono agganciati: e' l'ordine in
    // cui i fatti sono successi.
    function statoVettura(stagione, idPilota) {
        const stato = vetturaNuova();
        for (const gara of (stagione && stagione.risultati) || []) {
            const registrata = gara.usura && gara.usura[idPilota];
            if (registrata) Object.assign(stato, normalizzaUsura(registrata));
            const ricambi = gara.ricambiDopo && gara.ricambiDopo[idPilota];
            for (const c of ricambi || []) {
                if (COMPONENTI.indexOf(c) >= 0) stato[c] = 0;
            }
        }
        return stato;
    }
```

E cambiare `registraRisultato` perché porti l'usura:

```js
    function registraRisultato(stagione, { ordine, usura, adesso }) {
        if (finita(stagione)) throw new Error('la stagione è già finita');
        const pista = garaCorrente(stagione);
        // L'usura si normalizza QUI, una volta, all'ingresso: da qui in poi
        // nessun altro deve chiedersi se quei numeri sono buoni.
        const usuraPulita = {};
        for (const id in (usura || {})) usuraPulita[id] = normalizzaUsura(usura[id]);
        return Object.assign({}, stagione, {
            giro: stagione.giro + 1,
            risultati: stagione.risultati.concat([{
                pista,
                ordine: (ordine || []).slice(),
                usura: usuraPulita,
            }]),
            aggiornataIl: adesso || new Date().toISOString(),
        });
    }
```

Aggiungere all'oggetto restituito dalla factory: `COMPONENTI, COMPONENTI_PARCO_CHIUSO, vetturaNuova, statoVettura,`.

- [ ] **Step 5: Eseguire i test e verificare che passino**

Run: `node --test frontend/shared/f1Stagione.test.js`
Expected: PASS, tutti.

- [ ] **Step 6: Verificare che nessun test esistente sia diventato rosso**

Run: `node --test backend/ 2>&1 | grep "^not ok"`
Expected: lo stesso elenco dello Step 1.

`registraRisultato` ha una firma compatibile (il campo `usura` è facoltativo), quindi i chiamanti esistenti non cambiano.

- [ ] **Step 7: Commit**

```bash
git add frontend/shared/f1Stagione.js frontend/shared/f1Stagione.test.js
git commit -m "Parco chiuso: lo stato della vettura si calcola, non si salva

Un risultato di gara porta con se' com'era ridotta ogni macchina alla
bandiera. Lo stato attuale si ricava rigiocando la lista - stesso
principio gia' scritto qui sopra per la classifica: nel documento
stanno gli eventi, non i totali.

L'usura registrata e' il TOTALE alla bandiera, non l'incremento: si
prende l'ultima, non si somma.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: La gara scrive l'usura alla bandiera

**Files:**
- Modify: `backend/sockets/games/f1Stagione.server.js` (`registraGara`, funzione nuova `usuraDeiPiloti`)
- Modify: `backend/sockets/games/f1GameSocket.js` (la chiamata a `registraGara`, riga ~2693)
- Test: `backend/sockets/games/f1Stagione.server.test.js`

**Interfaces:**
- Consumes: `registraRisultato(..., { usura })` dal Task 1.
- Produces: `usuraDeiPiloti(stagione, players) -> { [idPilota]: {frontWing, floor, engine, suspension} }`; `registraGara(stagione, podium, players)` — **terzo parametro nuovo**.

- [ ] **Step 1: Scrivere i test che falliscono**

Aggiungere in fondo a `backend/sockets/games/f1Stagione.server.test.js`:

```js
// L'usura alla bandiera, tradotta negli id della stagione. Stessa regola di
// ordineDelPodio: gli umani per uid, i bot per colore.
test('usuraDeiPiloti: traduce i damageParts negli id della stagione', () => {
    const stagione = F1Stagione.creaStagione({
        nome: 'x', creataDa: 'uid-a',
        piloti: [{ uid: 'uid-a', colore: 'red' }, { colore: 'blue', bot: true }],
        calendario: ['prova'],
    });
    const players = {
        red:  { uid: 'uid-a', color: 'red',  isBot: false, damageParts: { frontWing: 40, floor: 12, engine: 35, suspension: 3 } },
        blue: { color: 'blue', isBot: true,  damageParts: { frontWing: 5, floor: 60, engine: 30, suspension: 0 } },
    };
    const usura = Stagione.usuraDeiPiloti(stagione, players);
    assert.deepEqual(usura.p1, { frontWing: 40, floor: 12, engine: 35, suspension: 3 });
    assert.deepEqual(usura.p2, { frontWing: 5, floor: 60, engine: 30, suspension: 0 });
});

test('usuraDeiPiloti: chi non appartiene alla stagione viene saltato', () => {
    // Stessa scelta di ordineDelPodio: un pilota in piu' in pista non e' un
    // buon motivo per perdere l'usura di tutti gli altri.
    const stagione = F1Stagione.creaStagione({
        nome: 'x', creataDa: 'uid-a',
        piloti: [{ uid: 'uid-a', colore: 'red' }],
        calendario: ['prova'],
    });
    const players = {
        red:    { uid: 'uid-a', color: 'red', isBot: false, damageParts: { frontWing: 1, floor: 2, engine: 3, suspension: 4 } },
        estraneo: { uid: 'uid-z', color: 'green', isBot: false, damageParts: { frontWing: 9, floor: 9, engine: 9, suspension: 9 } },
    };
    const usura = Stagione.usuraDeiPiloti(stagione, players);
    assert.deepEqual(Object.keys(usura), ['p1']);
});

test('usuraDeiPiloti: un giocatore senza damageParts non produce NaN', () => {
    const stagione = F1Stagione.creaStagione({
        nome: 'x', creataDa: 'uid-a',
        piloti: [{ uid: 'uid-a', colore: 'red' }],
        calendario: ['prova'],
    });
    const usura = Stagione.usuraDeiPiloti(stagione, {
        red: { uid: 'uid-a', color: 'red', isBot: false },
    });
    assert.deepEqual(usura.p1, { frontWing: 0, floor: 0, engine: 0, suspension: 0 });
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `node --test backend/sockets/games/f1Stagione.server.test.js`
Expected: FAIL — `Stagione.usuraDeiPiloti is not a function`.

- [ ] **Step 3: Scrivere la funzione**

In `backend/sockets/games/f1Stagione.server.js`, dopo `ordineDelPodio`:

```js
// L'usura di ogni macchina alla bandiera, tradotta negli id della stagione.
// Stessa regola di ordineDelPodio: chi non appartiene alla stagione viene
// SALTATO invece di far fallire tutto.
//
// `damageParts` puo' mancare (giocatore costruito a mano, o entrato e uscito
// prima che la fisica girasse): vale macchina nuova, come ovunque.
function usuraDeiPiloti(stagione, players) {
    const usura = {};
    for (const giocatore of Object.values(players || {})) {
        const id = idPilotaDi(stagione, giocatore);
        if (!id) continue;
        usura[id] = Object.assign(F1Stagione.vetturaNuova(), giocatore.damageParts || {});
    }
    return usura;
}
```

E cambiare `registraGara`:

```js
async function registraGara(stagione, podium, players) {
    const aggiornata = F1Stagione.registraRisultato(stagione, {
        ordine: ordineDelPodio(stagione, podium),
        usura: usuraDeiPiloti(stagione, players),
    });
    await seasonStore.salva(aggiornata);
    return aggiornata;
}
```

Aggiungere `usuraDeiPiloti` a `module.exports`.

- [ ] **Step 4: Passare i giocatori dal punto di salvataggio**

In `backend/sockets/games/f1GameSocket.js`, alla chiamata (riga ~2693):

```js
                const dopo = await Stagione.registraGara(stagione, podium, game.players);
```

- [ ] **Step 5: Eseguire i test e verificare che passino**

Run: `node --test backend/sockets/games/f1Stagione.server.test.js`
Expected: PASS.

- [ ] **Step 6: Verificare tutta la suite**

Run: `node --test backend/ 2>&1 | grep "^not ok"`
Expected: lo stesso elenco del Task 1 Step 1.

- [ ] **Step 7: Commit**

```bash
git add backend/sockets/games/f1Stagione.server.js backend/sockets/games/f1Stagione.server.test.js backend/sockets/games/f1GameSocket.js
git commit -m "La gara scrive l'usura alla bandiera

Nello stesso identico punto in cui salva il risultato: il salvataggio
del weekend resta uno solo.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: L'usura ereditata arriva al via del weekend

Il giro si chiude: quello che la gara ha scritto, il weekend successivo lo legge. Da qui in poi la macchina non rinasce più.

**Files:**
- Modify: `backend/sockets/games/f1Stagione.server.js` (`impostazioniPerLaProssimaGara`)
- Modify: `backend/sockets/games/f1GameSocket.js` (`resetStatoAuto` riga ~1120, e dove i giocatori nascono/entrano)
- Test: `backend/sockets/games/f1GameSocket.parcoChiuso.test.js` (nuovo)

**Interfaces:**
- Consumes: `statoVettura` dal Task 1.
- Produces: `p.usuraIniziale` (oggetto a 4 componenti, o assente); `impostazioniPerLaProssimaGara` porta `usuraStagione: { [colore]: {...} }`.

- [ ] **Step 1: Capire come le impostazioni arrivano al weekend**

Run: `grep -n "botStagione\|stagioneInCorso" backend/sockets/games/f1GameSocket.js | head -20`

`impostazioniPerLaProssimaGara` scrive dentro `lobby.gameSettings`, il client ricarica la pagina, e `joinF1Game` legge quelle impostazioni. `botStagione` viaggia già così ed è il modello da copiare: **l'usura segue la stessa strada, per COLORE**, perché al momento del join il colore è l'unica cosa che il server ha in mano per entrambi (umani e bot).

- [ ] **Step 2: Scrivere i test che falliscono**

Creare `backend/sockets/games/f1GameSocket.parcoChiuso.test.js`:

```js
// backend/sockets/games/f1GameSocket.parcoChiuso.test.js
//
// In stagione la macchina non rinasce ad ogni gara. Il punto delicato e' che
// l'azzeramento ha UN SOLO posto (resetStatoAuto): qui si verifica che quel
// posto adesso RIPRISTINA invece di azzerare, e che l'ala fa eccezione.
// Rif. docs/superpowers/specs/2026-08-23-f1-economia-della-gara-design.md
const test = require('node:test');
const assert = require('node:assert/strict');
const { physics } = require('./f1GameSocket.js');

function giocatore(usuraIniziale) {
    const p = {
        damage: 99, damageParts: { frontWing: 9, floor: 9, engine: 9, suspension: 9 },
        tyreWear: 50, inputs: { throttle: 0, brake: 0, steer: 0 },
    };
    if (usuraIniziale) p.usuraIniziale = usuraIniziale;
    return p;
}

test('resetStatoAuto: senza usuraIniziale la macchina e\' nuova, come sempre', () => {
    const p = giocatore();
    physics.resetStatoAuto(p);
    assert.deepEqual(p.damageParts, { frontWing: 0, floor: 0, engine: 0, suspension: 0 });
    assert.equal(p.damage, 0);
});

test('resetStatoAuto: in stagione riparte dall\'usura ereditata', () => {
    const p = giocatore({ frontWing: 40, floor: 12, engine: 35, suspension: 3 });
    physics.resetStatoAuto(p);
    assert.equal(p.damageParts.floor, 12);
    assert.equal(p.damageParts.engine, 35);
    assert.equal(p.damageParts.suspension, 3);
});

test('resetStatoAuto: l\'ala anteriore e\' SEMPRE nuova al via', () => {
    // E' l'eccezione dettata dall'utente: nella F1 vera l'ala la cambiano ai
    // box e via, quindi non fa parte del parco chiuso.
    const p = giocatore({ frontWing: 100, floor: 12, engine: 35, suspension: 3 });
    physics.resetStatoAuto(p);
    assert.equal(p.damageParts.frontWing, 0);
});

test('resetStatoAuto: p.damage resta il massimo dei quattro componenti', () => {
    const p = giocatore({ frontWing: 100, floor: 12, engine: 35, suspension: 3 });
    physics.resetStatoAuto(p);
    assert.equal(p.damage, 35, 'ala azzerata, quindi il massimo e\' il motore');
});

test('resetStatoAuto: l\'oggetto usuraIniziale non viene condiviso per riferimento', () => {
    // Stessa trappola gia' documentata per createDamageParts: due sessioni che
    // condividono lo stesso oggetto si sporcano a vicenda.
    const usura = { frontWing: 0, floor: 12, engine: 35, suspension: 3 };
    const p = giocatore(usura);
    physics.resetStatoAuto(p);
    p.damageParts.floor = 99;
    assert.equal(usura.floor, 12, 'l\'originale non deve muoversi');
});
```

- [ ] **Step 3: Eseguire i test e verificare che falliscano**

Run: `node --test backend/sockets/games/f1GameSocket.parcoChiuso.test.js`
Expected: FAIL — o `resetStatoAuto` non è esportata, o l'usura ereditata viene ignorata.

Se non è esportata, aggiungerla a `module.exports.physics` accanto ad `assignGridSpawns` (è lo stesso namespace usato dagli altri test di fisica).

- [ ] **Step 4: `resetStatoAuto` ripristina invece di azzerare**

In `backend/sockets/games/f1GameSocket.js`, sostituire le due righe del danno dentro `resetStatoAuto` (righe ~1130-1131):

```js
    // PARCO CHIUSO: in stagione la macchina non rinasce, riparte da com'era
    // alla bandiera precedente — e questo e' l'UNICO punto che lo decide, per
    // la qualifica come per la gara. E' anche cio' che rende vera la regola
    // "il danno preso in qualifica non entra in gara" senza programmarla: la
    // griglia rilegge sempre da qui.
    //
    // L'ala anteriore fa eccezione ed e' sempre nuova al via: nella F1 vera la
    // cambiano ai box e via, quindi non e' del parco chiuso.
    //
    // In gara veloce `usuraIniziale` non esiste e questo e' un azzeramento,
    // identico a prima.
    p.damageParts = createDamageParts();
    if (p.usuraIniziale) {
        for (const c of ['floor', 'engine', 'suspension']) {
            p.damageParts[c] = Math.max(0, Math.min(100, Number(p.usuraIniziale[c]) || 0));
        }
    }
    p.damage = Math.max(
        p.damageParts.frontWing, p.damageParts.floor,
        p.damageParts.engine, p.damageParts.suspension
    );
```

⚠️ `p.damage` va ricalcolato, non lasciato a 0: è derivato dal massimo dei quattro, e l'HUD lo mostra. Lasciarlo a zero darebbe un indicatore che dice «macchina sana» su una macchina consumata.

- [ ] **Step 5: L'usura viaggia con le impostazioni**

In `backend/sockets/games/f1Stagione.server.js`, dentro `impostazioniPerLaProssimaGara`, accanto a `botStagione`:

```js
        // L'usura con cui ogni pilota ARRIVA a questo weekend, per COLORE:
        // al momento del join il colore e' l'unica cosa che il server ha in
        // mano per umani e bot insieme. Stessa strada di botStagione, e per la
        // stessa ragione: createBots e joinF1Game sono sincrone e non possono
        // aspettare Mongo.
        usuraStagione: (stagione.piloti || []).reduce((acc, p) => {
            if (p.colore) acc[p.colore] = F1Stagione.statoVettura(stagione, p.id);
            return acc;
        }, {}),
```

- [ ] **Step 6: I giocatori ricevono la loro usura entrando**

Ci sono **due** posti dove nasce un giocatore, e vanno toccati entrambi: se uno resta indietro, in una stessa gara metà griglia parte consumata e metà nuova.

Run: `grep -n "damageParts: createDamageParts()" backend/sockets/games/f1GameSocket.js`
Run: `grep -n "botStagione" backend/sockets/games/f1GameSocket.js backend/sockets/games/f1Bot.js`

Il primo è l'oggetto giocatore di `joinF1Game` (~riga 534, dove c'è il commento su `damageParts`); il secondo è `createBots`, che legge già `botStagione` dalle impostazioni e che quindi ha `settings` sottomano. In entrambi, accanto agli altri campi iniziali:

```js
                // Parco chiuso: con che macchina questo pilota arriva al
                // weekend. Assente in gara veloce = macchina nuova. Copiato,
                // mai condiviso per riferimento (vedi createDamageParts).
                usuraIniziale: usuraStagioneDi(settings, colore),
```

e definire l'helper a livello di modulo:

```js
// L'usura ereditata di un colore, letta dalle impostazioni della partita.
// Restituisce SEMPRE un oggetto nuovo: due giocatori che condividessero lo
// stesso non potrebbero piu' consumarsi in modo indipendente.
function usuraStagioneDi(settings, colore) {
    const mappa = settings && settings.usuraStagione;
    const mia = mappa && mappa[colore];
    if (!mia) return null;
    return { frontWing: 0, floor: mia.floor || 0, engine: mia.engine || 0, suspension: mia.suspension || 0 };
}
```

⚠️ `gameSettings` viaggia come oggetto in memoria fra lobby e partita, quindi `usuraStagione` resta un oggetto e non va serializzato in stringa come `gridSize`/`botsEnabled` (quelli sono stringhe perché li scrive la lobby dal client — vedi il commento in `impostazioniPerLaProssimaGara`).

- [ ] **Step 7: Eseguire i test e verificare che passino**

Run: `node --test backend/sockets/games/f1GameSocket.parcoChiuso.test.js`
Expected: PASS.

- [ ] **Step 8: Verificare tutta la suite**

Run: `node --test backend/ 2>&1 | grep "^not ok"`
Expected: lo stesso elenco del Task 1 Step 1.

- [ ] **Step 9: Commit**

```bash
git add backend/sockets/games/f1GameSocket.js backend/sockets/games/f1Stagione.server.js backend/sockets/games/f1GameSocket.parcoChiuso.test.js
git commit -m "In stagione la macchina non rinasce ad ogni gara

resetStatoAuto smette di azzerare e RIPRISTINA l'usura ereditata: resta
un solo punto che decide lo stato iniziale, per la qualifica come per la
gara. Ed e' anche cio' che rende vera la regola 'il danno preso in
qualifica non entra in gara' senza programmarla.

L'ala e' sempre nuova al via: nella F1 vera la cambiano ai box e via.

p.damage si ricalcola come massimo dei quattro: lasciarlo a zero darebbe
un HUD che dice 'macchina sana' su una macchina consumata.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Ai box, in stagione, si ripara solo l'ala

**Files:**
- Modify: `backend/sockets/games/f1GameSocket.js` (il calcolo della durata sosta ~1664 e l'applicazione ~1724)
- Test: `backend/sockets/games/f1GameSocket.parcoChiuso.test.js`

**Interfaces:**
- Consumes: `p.usuraIniziale` come segno che si è in stagione (l'unico campo che distingue le due modalità sul giocatore).
- Produces: `COSTO_CAMBIO_ALA_MS` (costante).

- [ ] **Step 1: Leggere il codice della sosta**

Run: `sed -n '1655,1680p;1715,1735p' backend/sockets/games/f1GameSocket.js`

Serve a vedere la forma esatta di come `pendingRepair` entra nella durata e come viene applicato, prima di cambiarli.

- [ ] **Step 2: Scrivere i test che falliscono**

Aggiungere a `backend/sockets/games/f1GameSocket.parcoChiuso.test.js`:

```js
// Ai box, in stagione, si ripara SOLO l'ala anteriore: e' l'unica cosa che
// nella F1 vera si cambia durante una gara.
test('riparazione ai box: in gara veloce ripara tutto, come sempre', () => {
    const p = { damage: 60, damageParts: { frontWing: 60, floor: 40, engine: 30, suspension: 10 }, pendingRepair: true };
    physics.applicaRiparazione(p);
    assert.deepEqual(p.damageParts, { frontWing: 0, floor: 0, engine: 0, suspension: 0 });
    assert.equal(p.damage, 0);
});

test('riparazione ai box: in stagione ripara SOLO l\'ala', () => {
    const p = {
        damage: 60, damageParts: { frontWing: 60, floor: 40, engine: 30, suspension: 10 },
        pendingRepair: true, usuraIniziale: { frontWing: 0, floor: 20, engine: 20, suspension: 5 },
    };
    physics.applicaRiparazione(p);
    assert.equal(p.damageParts.frontWing, 0, 'l\'ala si cambia');
    assert.equal(p.damageParts.floor, 40, 'il fondo resta');
    assert.equal(p.damageParts.engine, 30, 'il motore resta');
    assert.equal(p.damageParts.suspension, 10, 'le sospensioni restano');
    assert.equal(p.damage, 40, 'p.damage torna il massimo dei quattro');
});

test('durata sosta: in stagione il tempo lo detta l\'ala, non il danno totale', () => {
    // Con la regola vecchia (p.damage) un fondo consumato al 90% avrebbe fatto
    // pagare una sosta lunghissima per cambiare un'ala intatta.
    const stagione = { damage: 90, damageParts: { frontWing: 0, floor: 90, engine: 0, suspension: 0 }, usuraIniziale: {} };
    assert.equal(physics.tempoRiparazioneMs(stagione), 0, 'ala intatta: nessun tempo in piu\'');
});

test('durata sosta: cambiare l\'ala costa un tempo fisso piu\' il proporzionale', () => {
    const p = { damage: 50, damageParts: { frontWing: 50, floor: 0, engine: 0, suspension: 0 }, usuraIniziale: {} };
    const atteso = physics.COSTO_CAMBIO_ALA_MS + 50 * physics.REPAIR_MS_PER_DAMAGE_PCT;
    assert.equal(physics.tempoRiparazioneMs(p), atteso);
});
```

- [ ] **Step 3: Eseguire i test e verificare che falliscano**

Run: `node --test backend/sockets/games/f1GameSocket.parcoChiuso.test.js`
Expected: FAIL — `physics.applicaRiparazione is not a function`.

- [ ] **Step 4: Estrarre le due decisioni in funzioni proprie**

Oggi la durata e l'applicazione sono due righe inline dentro il flusso della sosta. Estrarle serve a poterle provare senza montare una gara — e a tenere in un posto solo la regola «in stagione solo l'ala».

A livello di modulo in `backend/sockets/games/f1GameSocket.js`:

```js
// Montare l'ala nuova costa un tempo fisso, piu' il proporzionale al suo
// stato: e' quello che l'utente ha chiesto quando ha detto che ai box adesso
// "si perde piu' tempo, perche' non si cambiano solo le gomme".
const COSTO_CAMBIO_ALA_MS = 2000;

// In stagione si ripara SOLO l'ala anteriore. Chi e' in stagione lo dice
// `usuraIniziale`, l'unico campo che distingue le due modalita' sul
// giocatore: la fisica continua a non sapere che le stagioni esistono, e
// nemmeno questo punto ha bisogno di chiedere alla lobby che formato sia.
function inParcoChiuso(p) {
    return !!p.usuraIniziale;
}

function tempoRiparazioneMs(p) {
    if (!p.pendingRepair && p.pendingRepair !== undefined) { /* niente: la scelta la valuta il chiamante */ }
    const quanto = inParcoChiuso(p) ? (p.damageParts ? p.damageParts.frontWing : 0) : p.damage;
    if (!quanto) return 0;
    return (inParcoChiuso(p) ? COSTO_CAMBIO_ALA_MS : 0) + quanto * REPAIR_MS_PER_DAMAGE_PCT;
}

function applicaRiparazione(p) {
    if (!p.pendingRepair) return;
    if (inParcoChiuso(p)) {
        p.damageParts.frontWing = 0;
        p.damage = Math.max(
            p.damageParts.frontWing, p.damageParts.floor,
            p.damageParts.engine, p.damageParts.suspension
        );
    } else {
        p.damage = 0;
        p.damageParts = createDamageParts();
    }
    p.pendingRepair = false;
}
```

⚠️ Togliere la riga morta del primo `if` in `tempoRiparazioneMs` — è lì solo a segnalare che la valutazione di `pendingRepair` resta al chiamante, e un `if` vuoto è peggio di un commento. Scrivere invece:

```js
// La SCELTA di riparare la valuta il chiamante (p.pendingRepair): qui si
// risponde solo a "quanto costerebbe".
function tempoRiparazioneMs(p) {
    const quanto = inParcoChiuso(p) ? (p.damageParts ? p.damageParts.frontWing : 0) : p.damage;
    if (!quanto) return 0;
    return (inParcoChiuso(p) ? COSTO_CAMBIO_ALA_MS : 0) + quanto * REPAIR_MS_PER_DAMAGE_PCT;
}
```

- [ ] **Step 5: Usarle nel flusso della sosta**

Sostituire la riga ~1664:

```js
    if (p.pendingRepair) durationMs += tempoRiparazioneMs(p);
```

e la riga ~1724:

```js
    applicaRiparazione(p);
```

(la vecchia riga `p.pendingRepair = false;` subito dopo va tolta: ora lo fa `applicaRiparazione`).

Aggiungere `COSTO_CAMBIO_ALA_MS, REPAIR_MS_PER_DAMAGE_PCT, tempoRiparazioneMs, applicaRiparazione` a `module.exports.physics`.

- [ ] **Step 6: Eseguire i test e verificare che passino**

Run: `node --test backend/sockets/games/f1GameSocket.parcoChiuso.test.js`
Expected: PASS.

- [ ] **Step 7: Verificare tutta la suite**

Run: `node --test backend/ 2>&1 | grep "^not ok"`
Expected: lo stesso elenco del Task 1 Step 1.

⚠️ Controllare in particolare `f1GameSocket.pitReazione.test.js` e `f1Bot.pitStop.test.js`: toccano la durata della sosta. Se un valore atteso cambia, verificare che sia per la gara veloce (non dovrebbe: lì `usuraIniziale` non esiste e il comportamento è identico).

- [ ] **Step 8: Commit**

```bash
git add backend/sockets/games/f1GameSocket.js backend/sockets/games/f1GameSocket.parcoChiuso.test.js
git commit -m "Ai box, in stagione, si ripara solo l'ala

Le altre tre componenti non si toccano durante una gara, come nella F1
vera. Il tempo lo detta l'ala e non il danno totale: con la regola
vecchia un fondo consumato al 90% avrebbe fatto pagare una sosta
lunghissima per cambiare un'ala intatta.

Chi e' in stagione lo dice usuraIniziale, l'unico campo che distingue le
due modalita' sul giocatore: nemmeno questo punto deve chiedere alla
lobby che formato sia.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4b: Il motore si consuma dai chilometri

Senza questo, la dotazione morde **solo per chi sbatte**: oggi il danno arriva unicamente dagli urti (e dai fuoripista, per il fondo). Chi guida pulito arriverebbe all'ultima gara con il motore nuovo e l'intera economia — dotazione, penalità, la scelta difficile a metà campionato — non si accenderebbe mai. È la decisione 3 della spec, ed è il motivo per cui esiste tutto il resto.

Vale **solo in stagione**, e non è una scappatoia: in gara veloce l'utente ha detto esplicitamente che va bene com'è («questo potrebbe andare bene per le gare singole che sono veloci»). Il predicato è `inParcoChiuso(p)`, già introdotto nel Task 4 — nessun concetto nuovo, e resta fuori da `physics/`.

**Files:**
- Modify: `backend/sockets/games/f1GameSocket.js` (costante, funzione, chiamata nel tick accanto ad `applyTyreWear`)
- Test: `backend/sockets/games/f1GameSocket.parcoChiuso.test.js`

**Interfaces:**
- Consumes: `inParcoChiuso(p)` dal Task 4.
- Produces: `USURA_MOTORE_PER_GARA` (35), `consumaMotore(p, dist, track)`.

- [ ] **Step 1: Scrivere i test che falliscono**

Aggiungere a `backend/sockets/games/f1GameSocket.parcoChiuso.test.js`:

```js
// Il motore si consuma dai CHILOMETRI, non solo dagli urti. Senza, chi guida
// pulito arriverebbe all'ultima gara con la macchina nuova e la dotazione non
// morderebbe mai. E' la decisione che accende tutta l'economia.
function autoInStagione() {
    return {
        damage: 0, damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 },
        usuraIniziale: { frontWing: 0, floor: 0, engine: 0, suspension: 0 },
    };
}

const PISTA = { lapLength: 1000, totalLaps: 5 };   // 5000 unita' di gara

test('consumaMotore: una gara intera costa circa USURA_MOTORE_PER_GARA', () => {
    const p = autoInStagione();
    // Tutta la distanza di gara, un pezzo alla volta come farebbe il tick.
    for (let i = 0; i < 5000; i++) physics.consumaMotore(p, 1, PISTA);
    assert.ok(Math.abs(p.damageParts.engine - physics.USURA_MOTORE_PER_GARA) < 0.5,
        `atteso ~${physics.USURA_MOTORE_PER_GARA}, ottenuto ${p.damageParts.engine}`);
});

test('consumaMotore: un motore copre poco meno di tre gare', () => {
    // E' il numero che rende la dotazione una scelta: due motori su sei gare
    // coprono cinque gare e mezza.
    const p = autoInStagione();
    for (let i = 0; i < 3 * 5000; i++) physics.consumaMotore(p, 1, PISTA);
    assert.ok(p.damageParts.engine > 99, 'dopo tre gare e\' finito');
});

test('consumaMotore: in gara veloce non consuma niente', () => {
    const p = { damage: 0, damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 } };
    for (let i = 0; i < 5000; i++) physics.consumaMotore(p, 1, PISTA);
    assert.equal(p.damageParts.engine, 0);
});

test('consumaMotore: aggiorna p.damage, che l\'HUD mostra', () => {
    const p = autoInStagione();
    for (let i = 0; i < 2500; i++) physics.consumaMotore(p, 1, PISTA);
    assert.equal(p.damage, p.damageParts.engine);
});

test('consumaMotore: una pista senza totalLaps non produce NaN', () => {
    const p = autoInStagione();
    physics.consumaMotore(p, 10, { lapLength: 1000 });
    assert.ok(Number.isFinite(p.damageParts.engine));
});

test('consumaMotore: da fermo non consuma', () => {
    const p = autoInStagione();
    physics.consumaMotore(p, 0, PISTA);
    assert.equal(p.damageParts.engine, 0);
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `node --test backend/sockets/games/f1GameSocket.parcoChiuso.test.js`
Expected: FAIL — `physics.consumaMotore is not a function`.

- [ ] **Step 3: Scrivere la funzione**

A livello di modulo in `backend/sockets/games/f1GameSocket.js`:

```js
// Il motore si consuma dai CHILOMETRI, non solo dagli urti — l'unica
// componente che nella F1 vera si logora da sola. Una gara intera ne costa
// circa un terzo, quindi un motore copre poco meno di tre gare: e' il numero
// che rende la dotazione una scelta invece di una formalita'.
//
// Vale SOLO in stagione (`inParcoChiuso`): in gara veloce la macchina rinasce
// ad ogni via, e l'utente ha detto esplicitamente che li' va bene com'e'.
//
// Passa da addComponentDamage e non tocca damageParts.engine a mano: e' quello
// che ridiriva p.damage, che l'HUD mostra.
const USURA_MOTORE_PER_GARA = 35;

function consumaMotore(p, dist, track) {
    if (!inParcoChiuso(p) || !dist) return;
    const distanzaDiGara = (track.totalLaps || 1) * track.lapLength;
    if (!distanzaDiGara) return;
    addComponentDamage(p, dist * (USURA_MOTORE_PER_GARA / distanzaDiGara), { engine: 1 });
}
```

- [ ] **Step 4: Chiamarla nel tick**

Nel ciclo di `tickGame`, accanto ad `applyTyreWear` (che riceve già la stessa distanza percorsa nel tick):

```js
        if (game.phase === 'race' && !p.finished) applyTyreWear(p, offTrack, game.track);
        // Il motore si consuma dai chilometri. Come l'usura vale SOLO in gara:
        // il giro di rientro dopo la bandiera non deve costare niente, e la
        // qualifica non entra in stagione (vedi resetStatoAuto).
        if (game.phase === 'race' && !p.finished) consumaMotore(p, Math.hypot(p.vx, p.vz), game.track);
```

Aggiungere `USURA_MOTORE_PER_GARA, consumaMotore` a `module.exports.physics`.

- [ ] **Step 5: Eseguire i test e verificare che passino**

Run: `node --test backend/sockets/games/f1GameSocket.parcoChiuso.test.js`
Expected: PASS.

- [ ] **Step 6: Misurare quanto costa in pista, non solo in percentuale**

35% di motore è un numero astratto finché non si sa **quanto rallenta**. Misurarlo:

```bash
node -e "
const { getEnginePowerPenalty, DAMAGE_SPEED_PENALTY_MAX } = require('./backend/sockets/games/physics/DamageModel.js');
const { effectiveMaxSpeed } = require('./backend/sockets/games/physics/PowertrainModel.js');
const auto = (engine) => ({ tyreWear: 0, compound: 'medium', damageParts: { frontWing: 0, floor: 0, engine, suspension: 0 } });
const nuovo = effectiveMaxSpeed(auto(0), false);
for (const e of [35, 70, 100]) {
  const v = effectiveMaxSpeed(auto(e), false);
  console.log('motore al ' + e + '%: velocita massima ' + ((v/nuovo - 1) * 100).toFixed(2) + '%');
}"
```

**Criterio:** a fine PRIMA gara (35%) la perdita di velocità massima deve essere **percettibile ma non punitiva** — indicativamente fra l'1% e il 4%. Sotto l'1% la dotazione non ha peso e tanto vale non farla; sopra il 4% la prima gara di ogni motore è già una zavorra. Se è fuori, il numero da toccare è `USURA_MOTORE_PER_GARA` (non `DAMAGE_SPEED_PENALTY_MAX`, che governa anche il danno da urto). Riportare i valori nel commit.

- [ ] **Step 7: Verificare tutta la suite**

Run: `node --test backend/ 2>&1 | grep "^not ok"`
Expected: lo stesso elenco del Task 1 Step 1. In gara veloce non cambia nulla: `usuraIniziale` non esiste.

- [ ] **Step 8: Commit**

```bash
git add backend/sockets/games/f1GameSocket.js backend/sockets/games/f1GameSocket.parcoChiuso.test.js
git commit -m "Il motore si consuma dai chilometri

Senza, la dotazione mordeva solo per chi sbatte: chi guida pulito
sarebbe arrivato all'ultima gara col motore nuovo e l'intera economia
sarebbe restata spenta per una stagione intera.

Una gara costa ~35%, quindi un motore copre poco meno di tre gare: e'
il numero che rende la dotazione una scelta invece di una formalita'.

Vale solo in stagione: in gara veloce la macchina rinasce ad ogni via, e
li' l'utente ha detto che va bene com'e'.

Perdita di velocita' massima misurata: motore al 35% -> <X>%.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

(Sostituire `<X>` col numero vero misurato allo Step 6.)

---

### Task 5: Dotazione, ricambi e penalità — le regole pure

Il cuore della decisione. Tutto in `f1Stagione.js`, tutto provabile senza server.

**Files:**
- Modify: `frontend/shared/f1Stagione.js`
- Test: `frontend/shared/f1Stagione.test.js`

**Interfaces:**
- Consumes: `statoVettura`, `COMPONENTI_PARCO_CHIUSO` dal Task 1.
- Produces:
  - `DOTAZIONE_OGNI_N_GARE` (3), `PENALITA_GRIGLIA` (`{ engine: 5, suspension: 3, floor: 2 }`)
  - `dotazione(stagione) -> { floor, engine, suspension }`
  - `ricambiUsati(stagione, idPilota) -> { floor, engine, suspension }`
  - `ricambiRimasti(stagione, idPilota) -> { floor, engine, suspension }`
  - `registraOfficina(stagione, { ricambi, adesso })` — `ricambi` è `{ [idPilota]: ['engine', ...] }`
  - `officinaDaFare(stagione) -> boolean`
  - `penalitaGriglia(stagione, idPilota) -> number`

- [ ] **Step 1: Scrivere i test che falliscono**

Aggiungere in fondo a `frontend/shared/f1Stagione.test.js`:

```js
// ---- Dotazione, ricambi, penalita' ----------------------------------------
// Il freno alle sostituzioni e' la DOTAZIONE, non la sola penalita': senza,
// la strategia ottima sarebbe banale — riparare sempre tutto e prendersi la
// penalita' sul circuito dove si sorpassa meglio. La domanda diventa QUANDO
// spendere il ricambio, non SE.

function stagioneDaSeiGare() {
    return F1Stagione.creaStagione({
        nome: 'Sei', creataDa: 'uid-a',
        piloti: [{ uid: 'uid-a', colore: 'red' }, { colore: 'blue', bot: true }],
        calendario: ['a', 'b', 'c', 'd', 'e', 'f'],
    });
}

function conUnaGara(s, usura) {
    return F1Stagione.registraRisultato(s, { ordine: ['p1', 'p2'], usura: { p1: usura } });
}

test('dotazione: si calcola dalla lunghezza della stagione', () => {
    // Un numero fisso avrebbe significati diversi su calendari diversi.
    assert.equal(F1Stagione.dotazione(stagioneDaSeiGare()).engine, 2);
    const corta = F1Stagione.creaStagione({ nome: 'x', creataDa: 'u', piloti: [], calendario: ['a', 'b', 'c'] });
    assert.equal(F1Stagione.dotazione(corta).engine, 1);
});

test('officinaDaFare: dopo una gara si', () => {
    assert.equal(F1Stagione.officinaDaFare(stagioneDaSeiGare()), false, 'prima della prima gara no');
    const s = conUnaGara(stagioneDaSeiGare(), { engine: 40 });
    assert.equal(F1Stagione.officinaDaFare(s), true);
});

test('officinaDaFare: e\' uno STATO, non un momento — si riapre finche\' non si decide', () => {
    // Chi chiude il browser in officina la ritrova riaprendo la stagione,
    // senza aver perso la gara appena corsa.
    let s = conUnaGara(stagioneDaSeiGare(), { engine: 40 });
    assert.equal(F1Stagione.officinaDaFare(s), true);
    s = F1Stagione.registraOfficina(s, { ricambi: {} });
    assert.equal(F1Stagione.officinaDaFare(s), false, 'nessun ricambio e\' comunque una decisione');
});

test('officinaDaFare: a stagione finita non si apre', () => {
    let s = F1Stagione.creaStagione({ nome: 'x', creataDa: 'u', piloti: [{ uid: 'u', colore: 'red' }], calendario: ['a'] });
    s = F1Stagione.registraRisultato(s, { ordine: ['p1'], usura: { p1: { engine: 90 } } });
    assert.equal(F1Stagione.finita(s), true);
    assert.equal(F1Stagione.officinaDaFare(s), false, 'non c\'e\' nessuna gara dopo da preparare');
});

test('registraOfficina: il ricambio azzera il componente', () => {
    let s = conUnaGara(stagioneDaSeiGare(), { floor: 30, engine: 80, suspension: 10 });
    s = F1Stagione.registraOfficina(s, { ricambi: { p1: ['engine'] } });
    const stato = F1Stagione.statoVettura(s, 'p1');
    assert.equal(stato.engine, 0, 'motore nuovo');
    assert.equal(stato.floor, 30, 'il fondo non si tocca');
});

test('registraOfficina: l\'ala non e\' sostituibile in officina', () => {
    // E' gia' nuova ad ogni via: non ha dotazione e non ha penalita'.
    let s = conUnaGara(stagioneDaSeiGare(), { frontWing: 90, engine: 10 });
    s = F1Stagione.registraOfficina(s, { ricambi: { p1: ['frontWing'] } });
    assert.equal(F1Stagione.penalitaGriglia(s, 'p1'), 0, 'nessuna penalita\' per l\'ala');
    assert.deepEqual(F1Stagione.ricambiUsati(s, 'p1'), { floor: 0, engine: 0, suspension: 0 });
});

test('registraOfficina: due volte sulla stessa gara sostituisce la decisione, non la somma', () => {
    // Riaprire l'officina e cambiare idea non deve consumare due ricambi.
    let s = conUnaGara(stagioneDaSeiGare(), { engine: 80 });
    s = F1Stagione.registraOfficina(s, { ricambi: { p1: ['engine'] } });
    s = F1Stagione.registraOfficina(s, { ricambi: { p1: [] } });
    assert.equal(F1Stagione.ricambiUsati(s, 'p1').engine, 0);
    assert.equal(F1Stagione.statoVettura(s, 'p1').engine, 80, 'il motore vecchio e\' tornato');
});

test('ricambiRimasti: scalano con l\'uso', () => {
    let s = conUnaGara(stagioneDaSeiGare(), { engine: 80 });
    assert.equal(F1Stagione.ricambiRimasti(s, 'p1').engine, 2);
    s = F1Stagione.registraOfficina(s, { ricambi: { p1: ['engine'] } });
    assert.equal(F1Stagione.ricambiRimasti(s, 'p1').engine, 1);
});

test('penalitaGriglia: dentro la dotazione sostituire e\' gratis', () => {
    let s = conUnaGara(stagioneDaSeiGare(), { engine: 80 });
    s = F1Stagione.registraOfficina(s, { ricambi: { p1: ['engine'] } });
    assert.equal(F1Stagione.penalitaGriglia(s, 'p1'), 0);
});

test('penalitaGriglia: oltre la dotazione costa posizioni', () => {
    let s = stagioneDaSeiGare();
    // Due motori sono la dotazione: il terzo si paga.
    for (let i = 0; i < 3; i++) {
        s = F1Stagione.registraRisultato(s, { ordine: ['p1', 'p2'], usura: { p1: { engine: 90 } } });
        s = F1Stagione.registraOfficina(s, { ricambi: { p1: ['engine'] } });
    }
    assert.equal(F1Stagione.penalitaGriglia(s, 'p1'), F1Stagione.PENALITA_GRIGLIA.engine);
});

test('penalitaGriglia: vale solo per l\'ULTIMA officina, non si trascina', () => {
    // Una penalita' gia' scontata non si paga due volte.
    let s = stagioneDaSeiGare();
    for (let i = 0; i < 3; i++) {
        s = F1Stagione.registraRisultato(s, { ordine: ['p1', 'p2'], usura: { p1: { engine: 90 } } });
        s = F1Stagione.registraOfficina(s, { ricambi: { p1: ['engine'] } });
    }
    assert.ok(F1Stagione.penalitaGriglia(s, 'p1') > 0);
    s = F1Stagione.registraRisultato(s, { ordine: ['p1', 'p2'], usura: { p1: { engine: 20 } } });
    s = F1Stagione.registraOfficina(s, { ricambi: {} });
    assert.equal(F1Stagione.penalitaGriglia(s, 'p1'), 0, 'la penalita\' e\' stata scontata');
});

test('penalitaGriglia: piu\' ricambi oltre dotazione si sommano', () => {
    let s = stagioneDaSeiGare();
    for (let i = 0; i < 3; i++) {
        s = F1Stagione.registraRisultato(s, { ordine: ['p1', 'p2'], usura: { p1: { engine: 90, floor: 90 } } });
        s = F1Stagione.registraOfficina(s, { ricambi: { p1: ['engine', 'floor'] } });
    }
    assert.equal(F1Stagione.penalitaGriglia(s, 'p1'),
        F1Stagione.PENALITA_GRIGLIA.engine + F1Stagione.PENALITA_GRIGLIA.floor);
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `node --test frontend/shared/f1Stagione.test.js`
Expected: FAIL — `F1Stagione.dotazione is not a function`.

- [ ] **Step 3: Scrivere le regole**

In `frontend/shared/f1Stagione.js`, dopo `statoVettura`:

```js
    // Quante gare copre un ricambio. Su sei gare fanno due motori: con un
    // consumo di ~35% a gara un motore copre poco meno di tre gare, quindi due
    // arrivano a cinque e mezza — la penalita' verso il finale e' quasi
    // inevitabile, ma QUANDO prendersela lo decidi tu. E' esattamente la
    // tensione che l'utente ha scelto quando ha preferito la dotazione alla
    // sola penalita'.
    const DOTAZIONE_OGNI_N_GARE = 3;

    // Quanto costa sforare, in posizioni sulla griglia della gara successiva.
    // Tarati su griglie da 6-10 auto: mordono senza essere letali.
    const PENALITA_GRIGLIA = { engine: 5, suspension: 3, floor: 2 };

    function dotazione(stagione) {
        const gare = ((stagione && stagione.calendario) || []).length;
        const quanti = Math.max(1, Math.ceil(gare / DOTAZIONE_OGNI_N_GARE));
        const out = {};
        for (const c of COMPONENTI_PARCO_CHIUSO) out[c] = quanti;
        return out;
    }

    // I ricambi decisi dopo la gara `indice`, ripuliti: solo componenti del
    // parco chiuso, senza duplicati. L'ala non passa di qui — e' gia' nuova ad
    // ogni via, non ha dotazione e non ha penalita'.
    function ricambiPuliti(elenco) {
        const visti = [];
        for (const c of elenco || []) {
            if (COMPONENTI_PARCO_CHIUSO.indexOf(c) >= 0 && visti.indexOf(c) < 0) visti.push(c);
        }
        return visti;
    }

    function ricambiUsati(stagione, idPilota) {
        const out = {};
        for (const c of COMPONENTI_PARCO_CHIUSO) out[c] = 0;
        for (const gara of (stagione && stagione.risultati) || []) {
            for (const c of ricambiPuliti(gara.ricambiDopo && gara.ricambiDopo[idPilota])) out[c]++;
        }
        return out;
    }

    function ricambiRimasti(stagione, idPilota) {
        const totale = dotazione(stagione);
        const usati = ricambiUsati(stagione, idPilota);
        const out = {};
        for (const c of COMPONENTI_PARCO_CHIUSO) out[c] = Math.max(0, totale[c] - usati[c]);
        return out;
    }

    // L'officina NON e' un momento, e' uno STATO: "questa stagione e' fra due
    // gare e per l'ultima corsa non risulta ancora una decisione". Chi chiude
    // il browser la ritrova riaprendo la stagione, senza aver perso la gara
    // appena corsa — e "nessun ricambio" e' comunque una decisione, che e' cio'
    // che la chiude.
    //
    // A stagione finita non si apre: non c'e' nessuna gara dopo da preparare.
    function officinaDaFare(stagione) {
        if (!stagione || !stagione.risultati.length || finita(stagione)) return false;
        const ultima = stagione.risultati[stagione.risultati.length - 1];
        return !ultima.ricambiDopo;
    }

    // Attacca la decisione all'ULTIMA gara corsa. Riaprire l'officina e
    // cambiare idea SOSTITUISCE la decisione invece di sommarsi: altrimenti
    // un ripensamento consumerebbe due ricambi.
    //
    // Non muta: come registraRisultato, chi salva su Mongo deve poter fallire
    // senza aver gia' sporcato l'oggetto in memoria.
    function registraOfficina(stagione, { ricambi, adesso }) {
        if (!stagione || !stagione.risultati.length) throw new Error('non c\'è nessuna gara da cui uscire');
        const puliti = {};
        for (const id in (ricambi || {})) puliti[id] = ricambiPuliti(ricambi[id]);
        const risultati = stagione.risultati.slice();
        const ultimo = risultati[risultati.length - 1];
        risultati[risultati.length - 1] = Object.assign({}, ultimo, { ricambiDopo: puliti });
        return Object.assign({}, stagione, {
            risultati,
            aggiornataIl: adesso || new Date().toISOString(),
        });
    }

    // Quante posizioni perde questo pilota sulla griglia della PROSSIMA gara.
    //
    // Guarda solo l'ULTIMA officina: una penalita' gia' scontata non si paga
    // due volte. Si paga solo cio' che ha sforato la dotazione, e la dotazione
    // si conta ESCLUDENDO l'ultima officina — altrimenti il ricambio appena
    // deciso risulterebbe gia' speso e sembrerebbe sempre fuori quota.
    function penalitaGriglia(stagione, idPilota) {
        const risultati = (stagione && stagione.risultati) || [];
        if (!risultati.length) return 0;
        const ultima = ricambiPuliti(
            risultati[risultati.length - 1].ricambiDopo &&
            risultati[risultati.length - 1].ricambiDopo[idPilota]
        );
        if (!ultima.length) return 0;

        const totale = dotazione(stagione);
        const primaDiAdesso = {};
        for (const c of COMPONENTI_PARCO_CHIUSO) primaDiAdesso[c] = 0;
        for (let i = 0; i < risultati.length - 1; i++) {
            for (const c of ricambiPuliti(risultati[i].ricambiDopo && risultati[i].ricambiDopo[idPilota])) {
                primaDiAdesso[c]++;
            }
        }

        let posizioni = 0;
        for (const c of ultima) {
            primaDiAdesso[c]++;
            if (primaDiAdesso[c] > totale[c]) posizioni += PENALITA_GRIGLIA[c] || 0;
        }
        return posizioni;
    }
```

Aggiungere all'oggetto restituito: `DOTAZIONE_OGNI_N_GARE, PENALITA_GRIGLIA, dotazione, ricambiUsati, ricambiRimasti, registraOfficina, officinaDaFare, penalitaGriglia,`.

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `node --test frontend/shared/f1Stagione.test.js`
Expected: PASS, tutti.

- [ ] **Step 5: Verificare tutta la suite**

Run: `node --test backend/ 2>&1 | grep "^not ok"`
Expected: lo stesso elenco del Task 1 Step 1.

- [ ] **Step 6: Commit**

```bash
git add frontend/shared/f1Stagione.js frontend/shared/f1Stagione.test.js
git commit -m "Dotazione, ricambi e penalita' in griglia

Il freno alle sostituzioni e' la dotazione, non la sola penalita': senza,
la strategia ottima sarebbe banale - riparare sempre tutto e prendersi la
penalita' sul circuito dove si sorpassa meglio. La domanda diventa QUANDO
spendere il ricambio, non SE.

La dotazione si calcola dalla lunghezza della stagione: un numero fisso
avrebbe significati diversi su calendari diversi. Su sei gare fanno due
motori, che coprono cinque gare e mezza.

L'officina e' uno STATO, non un momento: chi chiude il browser la
ritrova, e 'nessun ricambio' e' comunque una decisione. Riaprirla e
cambiare idea sostituisce invece di sommare.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: La regola dei bot in officina

**Files:**
- Modify: `frontend/shared/f1Stagione.js`
- Test: `frontend/shared/f1Stagione.test.js`

**Interfaces:**
- Consumes: `statoVettura`, `ricambiRimasti` dal Task 5.
- Produces: `SOGLIA_BOT_CON_DOTAZIONE` (60), `SOGLIA_BOT_SENZA_DOTAZIONE` (85), `ricambiDelBot(stagione, idPilota) -> string[]`

- [ ] **Step 1: Scrivere i test che falliscono**

Aggiungere a `frontend/shared/f1Stagione.test.js`:

```js
// I bot subiscono la stessa economia del giocatore. Se ripartissero nuovi ogni
// volta il campionato diventerebbe una discesa: piu' vai avanti piu' sei in
// svantaggio, e riparare smetterebbe di essere una scelta per diventare un
// obbligo. La regola e' dichiarata e leggibile, non un'IA.
test('ricambiDelBot: sotto soglia non sostituisce niente', () => {
    let s = conUnaGara(stagioneDaSeiGare(), { engine: 30, floor: 10 });
    assert.deepEqual(F1Stagione.ricambiDelBot(s, 'p1'), []);
});

test('ricambiDelBot: sopra soglia sostituisce, finche\' ha dotazione', () => {
    let s = conUnaGara(stagioneDaSeiGare(), { engine: 70, floor: 10 });
    assert.deepEqual(F1Stagione.ricambiDelBot(s, 'p1'), ['engine']);
});

test('ricambiDelBot: esaurita la dotazione alza l\'asticella', () => {
    // Senza la seconda soglia si autopenalizzerebbe ogni gara per un fondo
    // mezzo consumato.
    let s = stagioneDaSeiGare();
    for (let i = 0; i < 2; i++) {
        s = F1Stagione.registraRisultato(s, { ordine: ['p1', 'p2'], usura: { p1: { engine: 95 } } });
        s = F1Stagione.registraOfficina(s, { ricambi: { p1: ['engine'] } });
    }
    assert.equal(F1Stagione.ricambiRimasti(s, 'p1').engine, 0);
    s = F1Stagione.registraRisultato(s, { ordine: ['p1', 'p2'], usura: { p1: { engine: 70 } } });
    assert.deepEqual(F1Stagione.ricambiDelBot(s, 'p1'), [], '70% non basta piu\'');
    let t = F1Stagione.registraRisultato(
        F1Stagione.registraOfficina(s, { ricambi: {} }),
        { ordine: ['p1', 'p2'], usura: { p1: { engine: 90 } } });
    assert.deepEqual(F1Stagione.ricambiDelBot(t, 'p1'), ['engine'], '90% sì, penalita\' compresa');
});

test('ricambiDelBot: non propone mai l\'ala', () => {
    let s = conUnaGara(stagioneDaSeiGare(), { frontWing: 100, engine: 10 });
    assert.deepEqual(F1Stagione.ricambiDelBot(s, 'p1'), []);
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `node --test frontend/shared/f1Stagione.test.js`
Expected: FAIL — `F1Stagione.ricambiDelBot is not a function`.

- [ ] **Step 3: Scrivere la regola**

In `frontend/shared/f1Stagione.js`, dopo `penalitaGriglia`:

```js
    // Cosa sostituisce un bot fra una gara e l'altra. Regola dichiarata, non
    // un'IA: sopra la prima soglia finche' ha dotazione, sopra la seconda
    // anche accettando la penalita'. La seconda soglia serve a impedire che si
    // autopenalizzi ogni gara per un fondo mezzo consumato.
    //
    // La differenziazione per livello di difficolta' appartiene al blocco H
    // (bot competitivi) e qui non si fa.
    const SOGLIA_BOT_CON_DOTAZIONE = 60;
    const SOGLIA_BOT_SENZA_DOTAZIONE = 85;

    function ricambiDelBot(stagione, idPilota) {
        const stato = statoVettura(stagione, idPilota);
        const rimasti = ricambiRimasti(stagione, idPilota);
        const scelti = [];
        for (const c of COMPONENTI_PARCO_CHIUSO) {
            const soglia = rimasti[c] > 0 ? SOGLIA_BOT_CON_DOTAZIONE : SOGLIA_BOT_SENZA_DOTAZIONE;
            if (stato[c] > soglia) scelti.push(c);
        }
        return scelti;
    }
```

Aggiungere all'oggetto restituito: `SOGLIA_BOT_CON_DOTAZIONE, SOGLIA_BOT_SENZA_DOTAZIONE, ricambiDelBot,`.

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `node --test frontend/shared/f1Stagione.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/shared/f1Stagione.js frontend/shared/f1Stagione.test.js
git commit -m "I bot passano dall'officina come tutti

Regola dichiarata, non un'IA: sopra il 60% finche' hanno dotazione,
sopra l'85% anche pagando la penalita'. La seconda soglia impedisce che
si autopenalizzino ogni gara per un fondo mezzo consumato.

Se i bot ripartissero nuovi ogni volta il campionato sarebbe una
discesa, e riparare smetterebbe di essere una scelta.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: La rotta dell'officina

⚠️ Questo task **cambia deliberatamente un'invariante**: introduce una seconda scrittura sul documento della stagione. Il test che protegge l'assenza di altre scritture va aggiornato, non aggirato.

**Files:**
- Modify: `backend/routes/f1Stagioni.js` (rotta nuova)
- Modify: `backend/sockets/games/f1GameSocket.stagione.test.js` (l'invariante, ~riga 282)
- Test: `backend/routes/f1Stagioni.test.js`

**Interfaces:**
- Consumes: `registraOfficina`, `officinaDaFare`, `ricambiDelBot` dai Task 5-6.
- Produces: `POST /api/f1/stagioni/:id/officina` con body `{ ricambi: string[] }` (i propri, non quelli degli altri).

- [ ] **Step 1: Scrivere i test che falliscono**

Aggiungere a `backend/routes/f1Stagioni.test.js`. Il file ha già gli helper `avviaServer()` e `chiedi(server, { metodo, percorso, uid, corpo })`, che restituisce `{ stato, dati }` — usare quelli, non inventarne altri.

```js
// L'officina e' una SECONDA scrittura sul documento, e va bene: non e' il
// weekend, e' un'azione esplicita dell'utente fra due weekend, come creare la
// stagione. L'invariante che resta e' piu' precisa di prima: il weekend scrive
// una volta sola, alla bandiera.
// Rif. docs/superpowers/specs/2026-08-23-f1-economia-della-gara-design.md
const F1Stagione = require('../../frontend/shared/f1Stagione.js');

// Una stagione con UNA gara gia' corsa e il motore quasi finito: e' lo stato
// in cui l'officina ha senso.
async function stagioneConUnaGara() {
    let s = F1Stagione.creaStagione({
        nome: 'Officina', creataDa: 'uid-andrea',
        piloti: [{ uid: 'uid-andrea', colore: 'red' }, { colore: 'blue', bot: true }],
        calendario: ['prova', 'new-monza', 'monte-rosso'],
    });
    s = F1Stagione.registraRisultato(s, {
        ordine: ['p1', 'p2'],
        usura: {
            p1: { frontWing: 30, floor: 20, engine: 90, suspension: 5 },
            p2: { frontWing: 10, floor: 10, engine: 95, suspension: 0 },
        },
    });
    return seasonStore.salva(s);
}

test('POST officina: registra i ricambi del richiedente e quelli dei bot', async (t) => {
    // I bot li decide il SERVER: se arrivassero dal client, uno potrebbe
    // regalare motori nuovi ai rivali o lasciarli a piedi.
    t.after(() => seasonStore._svuota());
    const server = await avviaServer();
    t.after(() => server.close());
    const s = await stagioneConUnaGara();

    const r = await chiedi(server, {
        metodo: 'POST', percorso: `/api/f1/stagioni/${s._id}/officina`,
        uid: 'uid-andrea', corpo: { ricambi: ['engine'] },
    });
    assert.equal(r.stato, 200);

    const dopo = await seasonStore.leggi(s._id);
    assert.deepEqual(dopo.risultati[0].ricambiDopo.p1, ['engine']);
    assert.deepEqual(dopo.risultati[0].ricambiDopo.p2, ['engine'],
        'il bot col motore al 95% lo sostituisce da solo');
});

test("POST officina: un estraneo non puo' toccare la stagione", async (t) => {
    t.after(() => seasonStore._svuota());
    const server = await avviaServer();
    t.after(() => server.close());
    const s = await stagioneConUnaGara();

    const r = await chiedi(server, {
        metodo: 'POST', percorso: `/api/f1/stagioni/${s._id}/officina`,
        uid: 'uid-estraneo', corpo: { ricambi: ['engine'] },
    });
    assert.equal(r.stato, 403);
});

test("POST officina: la seconda chiamata SOSTITUISCE la decisione, non la somma", async (t) => {
    // Riaprire l'officina e cambiare idea non deve consumare due ricambi.
    t.after(() => seasonStore._svuota());
    const server = await avviaServer();
    t.after(() => server.close());
    const s = await stagioneConUnaGara();

    await chiedi(server, { metodo: 'POST', percorso: `/api/f1/stagioni/${s._id}/officina`, uid: 'uid-andrea', corpo: { ricambi: ['engine'] } });
    await chiedi(server, { metodo: 'POST', percorso: `/api/f1/stagioni/${s._id}/officina`, uid: 'uid-andrea', corpo: { ricambi: [] } });

    const dopo = await seasonStore.leggi(s._id);
    assert.deepEqual(dopo.risultati[0].ricambiDopo.p1, []);
    assert.equal(F1Stagione.ricambiUsati(dopo, 'p1').engine, 0);
});

test("POST officina: prima della prima gara non c'e' niente da preparare", async (t) => {
    t.after(() => seasonStore._svuota());
    const server = await avviaServer();
    t.after(() => server.close());
    const nuova = await seasonStore.salva(F1Stagione.creaStagione({
        nome: 'Vergine', creataDa: 'uid-andrea',
        piloti: [{ uid: 'uid-andrea', colore: 'red' }],
        calendario: ['prova', 'new-monza'],
    }));

    const r = await chiedi(server, {
        metodo: 'POST', percorso: `/api/f1/stagioni/${nuova._id}/officina`,
        uid: 'uid-andrea', corpo: { ricambi: ['engine'] },
    });
    assert.equal(r.stato, 409);
});

test('POST officina: un componente inventato viene ignorato, non fa fallire', async (t) => {
    t.after(() => seasonStore._svuota());
    const server = await avviaServer();
    t.after(() => server.close());
    const s = await stagioneConUnaGara();

    const r = await chiedi(server, {
        metodo: 'POST', percorso: `/api/f1/stagioni/${s._id}/officina`,
        uid: 'uid-andrea', corpo: { ricambi: ['turbina', 'engine', 'frontWing'] },
    });
    assert.equal(r.stato, 200);
    const dopo = await seasonStore.leggi(s._id);
    assert.deepEqual(dopo.risultati[0].ricambiDopo.p1, ['engine'],
        "turbina non esiste, e l'ala non e' del parco chiuso");
});
```

⚠️ Se `seasonStore.salva` non restituisce il documento con `_id`, leggere come fanno i test già presenti nel file e adeguarsi: non inventare un secondo modo di ricavare l'id.

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `node --test backend/routes/f1Stagioni.test.js`
Expected: FAIL con 404 (la rotta non esiste).

- [ ] **Step 3: Scrivere la rotta**

In `backend/routes/f1Stagioni.js`, accanto alle altre:

```js
    // L'officina fra due gare. E' la SECONDA scrittura sul documento di una
    // stagione, e va bene: non e' il weekend, e' un'azione esplicita
    // dell'utente fra due weekend, come crearla. L'invariante che resta —
    // "il weekend scrive una volta sola, alla bandiera" — non e' toccata.
    //
    // I ricambi dei BOT li decide il server: se arrivassero dal client uno
    // potrebbe regalare motori nuovi ai rivali, o lasciarli a piedi.
    router.post('/api/f1/stagioni/:id/officina', autentica, express.json(), async (req, res) => {
        try {
            const stagione = await seasonStore.leggi(req.params.id);
            if (!stagione) return res.status(404).json({ error: 'Stagione non trovata' });

            const mio = (stagione.piloti || []).find(p => !p.bot && p.uid === req.uid);
            if (!mio) return res.status(403).json({ error: 'Non corri in questa stagione' });

            if (!F1Stagione.officinaDaFare(stagione)) {
                return res.status(409).json({ error: 'Non c\'è nessuna gara da preparare' });
            }

            const ricambi = {};
            ricambi[mio.id] = Array.isArray(req.body && req.body.ricambi) ? req.body.ricambi : [];
            for (const p of stagione.piloti) {
                if (p.id === mio.id) continue;
                // Gli altri umani decidono per sé con la propria chiamata; i
                // bot li decide la regola.
                if (p.bot) ricambi[p.id] = F1Stagione.ricambiDelBot(stagione, p.id);
            }

            const dopo = F1Stagione.registraOfficina(stagione, { ricambi });
            await seasonStore.salva(dopo);
            res.json({ stagione: dopo });
        } catch (err) {
            console.error('POST /api/f1/stagioni/:id/officina:', err);
            res.status(500).json({ error: 'Impossibile registrare i ricambi' });
        }
    });
```

⚠️ In multigiocatore ogni umano dovrebbe poter decidere per sé, ma `registraOfficina` **sostituisce** l'intera mappa: la seconda chiamata cancellerebbe la scelta del primo. Nella versione di questo task la decisione la fa **chi ospita** — è coerente con come funziona già «Corri» — e il campo degli altri umani resta vuoto. Va scritto nel commento della rotta, ed è la prima cosa da riprendere se il multigiocatore in stagione diventa comune.

- [ ] **Step 4: Aggiornare deliberatamente l'invariante**

In `backend/sockets/games/f1GameSocket.stagione.test.js`, il test `'un weekend abbandonato a meta non conta: la stagione resta ferma'` (~riga 282): aggiornare il commento perché dica la regola nuova, senza cambiare cosa verifica (quel test riguarda il weekend, non l'officina):

```js
    // La regola dettata dall'utente: chi chiude il browser a meta' weekend
    // perde il weekend, non la stagione. Si ottiene NON salvando mai a meta',
    // e questo test protegge proprio l'assenza di un salvataggio.
    //
    // Dal 2026-08-23 esiste una seconda scrittura sul documento — l'officina
    // fra due gare (POST /api/f1/stagioni/:id/officina) — e non la contraddice:
    // l'invariante e' "il WEEKEND scrive una volta sola, alla bandiera", e
    // l'officina non e' il weekend.
```

- [ ] **Step 5: Eseguire i test e verificare che passino**

Run: `node --test backend/routes/f1Stagioni.test.js`
Expected: PASS.

- [ ] **Step 6: Verificare tutta la suite**

Run: `node --test backend/ 2>&1 | grep "^not ok"`
Expected: lo stesso elenco del Task 1 Step 1.

- [ ] **Step 7: Commit**

```bash
git add backend/routes/f1Stagioni.js backend/routes/f1Stagioni.test.js backend/sockets/games/f1GameSocket.stagione.test.js
git commit -m "La rotta dell'officina

Seconda scrittura sul documento della stagione, e va bene: non e' il
weekend, e' un'azione esplicita fra due weekend, come crearla.
L'invariante che resta e' piu' precisa di prima - il WEEKEND scrive una
volta sola, alla bandiera - e il commento del test che la protegge lo
dice adesso.

I ricambi dei bot li decide il server: se arrivassero dal client uno
potrebbe regalare motori nuovi ai rivali o lasciarli a piedi.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: La schermata dell'officina

Fra il riepilogo della gara e il calendario. Sorella delle altre schermate della stagione: stesse classi, stessa palette.

**Files:**
- Modify: `frontend/f1.html` (il pannello, e il `?v=` di `f1StagioneSchermate.js`)
- Modify: `frontend/shared/f1StagioneSchermate.js` (`mostraVista`, `disegnaOfficina`, l'aggancio dopo il riepilogo)
- Modify: `frontend/styles/f1.css` (solo se servono classi nuove; riusare `.mescole-*` dove possibile)

**Interfaces:**
- Consumes: `statoVettura`, `ricambiRimasti`, `dotazione`, `PENALITA_GRIGLIA`, `officinaDaFare` da `f1Stagione.js`; `POST /api/f1/stagioni/:id/officina`.
- Produces: niente per altri task.

⚠️ **L'utente lavora su questi file.** Prima di editare: `git diff frontend/f1.html frontend/shared/f1StagioneSchermate.js frontend/styles/f1.css > /tmp/utente.patch`, e committare con la tecnica descritta nei Global Constraints.

- [ ] **Step 1: Leggere come sono fatte le sorelle**

Run: `grep -n "function disegnaRiepilogo" -A 40 frontend/shared/f1StagioneSchermate.js`
Run: `grep -n "function mostraVista" -A 30 frontend/shared/f1StagioneSchermate.js`

L'officina è una vista in più nello stesso meccanismo. Non inventare un secondo modo di mostrare/nascondere pannelli.

- [ ] **Step 2: Il pannello**

In `frontend/f1.html`, accanto agli altri pannelli della stagione, un `<div id="stagione-officina" style="display:none;">` con:
- testata in stile `.mescole-testata`: eyebrow «Fra una gara e l'altra», titolo «Officina»;
- una riga per componente (Fondo, Motore, Sospensioni) con: nome, **barra di usura**, ricambi rimasti, e un pulsante «Sostituisci» che dice **quanto costa** — «gratis» se la dotazione basta, «−5 posizioni» se no;
- in fondo il totale della penalità e un pulsante «Vai al calendario».

L'ala **non compare**: è già nuova ad ogni via.

- [ ] **Step 3: Disegnarla**

In `frontend/shared/f1StagioneSchermate.js`, una `disegnaOfficina(stagione)` che:
1. legge `F1Stagione.statoVettura`, `ricambiRimasti`, `dotazione`;
2. tiene la selezione in una variabile locale (`let scelti = []`), aggiornando il totale penalità **dal vivo** con `F1Stagione.PENALITA_GRIGLIA` — la penalità va vista **prima** di confermare, non dopo;
3. alla conferma chiama la rotta e poi passa al calendario;
4. se la chiamata fallisce, **non** avanza: mostra l'errore e lascia la schermata aperta. L'officina è uno stato: riaprendo la stagione ci si ritorna, quindi non c'è niente da perdere.

E in `mostraVista` aggiungere il caso `'officina'`.

- [ ] **Step 4: Agganciarla al flusso**

Dopo il riepilogo di fine gara, invece di andare dritti al calendario: se `F1Stagione.officinaDaFare(stagione)` è vera, si passa dall'officina.

E all'apertura di una stagione salvata: se `officinaDaFare` è vera, si apre lì. È quello che rende vero «chi chiude il browser in officina la ritrova».

- [ ] **Step 5: Alzare il cache-busting**

Run: `grep -n "f1StagioneSchermate.js?v=" frontend/f1.html`

Incrementare la versione.

- [ ] **Step 6: Verificare a schermo**

⚠️ Chrome headless è installato e la UI si può vedere davvero — non fidarsi della lettura del codice per una schermata nuova.

La tecnica che ha già funzionato: uno script Node che estrae il markup **vero** dal `f1.html` (bilanciando i tag `<div>`, non tagliando al primo commento), riempie i valori a mano, e lo salva in una pagina che linka `frontend/styles/f1.css`. Poi:

```bash
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless --disable-gpu \
  --window-size=1600,900 --screenshot=officina.png file:///.../sonda-officina.html
```

Controllare: le tre righe stanno tutte nel foglio, la penalità totale si legge, e un componente **senza** ricambi rimasti si distingue a colpo d'occhio da uno che ne ha.

- [ ] **Step 7: Commit**

Con la tecnica dei soli hunk propri (vedi Global Constraints), poi:

```bash
git commit -m "La schermata dell'officina

Fra il riepilogo della gara e il calendario. La penalita' si vede PRIMA
di confermare, non dopo: e' la decisione, non la sua conseguenza.

L'ala non compare: e' gia' nuova ad ogni via.

Se la chiamata fallisce non si avanza. L'officina e' uno stato:
riaprendo la stagione ci si ritorna, quindi non c'e' niente da perdere.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: La penalità in griglia

L'ultimo pezzo, e il più visibile: «hai fatto la pole e parti terzo».

**Files:**
- Modify: `backend/sockets/games/f1GameSocket.js` (`endQualifying`, riga ~1236)
- Modify: `backend/sockets/games/f1Stagione.server.js` (`impostazioniPerLaProssimaGara`: la penalità viaggia con le impostazioni)
- Test: `backend/sockets/games/f1GameSocket.parcoChiuso.test.js`

**Interfaces:**
- Consumes: `penalitaGriglia` dal Task 5.
- Produces: `applicaPenalitaGriglia(ordine, penalitaPerColore) -> string[]`; `impostazioniPerLaProssimaGara` porta `penalitaGriglia: { [colore]: number }`.

- [ ] **Step 1: Scrivere i test che falliscono**

Aggiungere a `backend/sockets/games/f1GameSocket.parcoChiuso.test.js`:

```js
// "Hai fatto la pole e parti terzo": la penalita' si applica DOPO la
// qualifica, prima che la griglia venga mostrata. La sequenza qualifica →
// griglia esiste gia', va solo alimentata.
test('penalita\' in griglia: senza penalita\' l\'ordine e\' quello della qualifica', () => {
    const ordine = ['red', 'blue', 'green'];
    assert.deepEqual(physics.applicaPenalitaGriglia(ordine, {}), ordine);
});

test('penalita\' in griglia: chi e\' penalizzato scala di N posizioni', () => {
    const ordine = ['red', 'blue', 'green', 'yellow'];
    assert.deepEqual(
        physics.applicaPenalitaGriglia(ordine, { red: 2 }),
        ['blue', 'green', 'red', 'yellow']
    );
});

test('penalita\' in griglia: non si scende sotto l\'ultima piazzola', () => {
    const ordine = ['red', 'blue', 'green'];
    assert.deepEqual(
        physics.applicaPenalitaGriglia(ordine, { red: 99 }),
        ['blue', 'green', 'red']
    );
});

test('penalita\' in griglia: con piu\' penalizzati si applica prima la piu\' grande', () => {
    // E' la regola della F1 vera, e senza un ordine dichiarato il risultato
    // dipenderebbe da come e' scritto un ciclo.
    const ordine = ['red', 'blue', 'green', 'yellow'];
    const dopo = physics.applicaPenalitaGriglia(ordine, { red: 2, blue: 5 });
    assert.equal(dopo.indexOf('blue'), 3, 'blue, penalizzato di piu\', finisce ultimo');
    assert.ok(dopo.indexOf('red') > 0, 'red comunque arretra');
    assert.equal(dopo.length, 4, 'nessuno sparisce e nessuno si duplica');
    assert.equal(new Set(dopo).size, 4);
});

test('penalita\' in griglia: un colore che non corre viene ignorato', () => {
    const ordine = ['red', 'blue'];
    assert.deepEqual(physics.applicaPenalitaGriglia(ordine, { viola: 5 }), ['red', 'blue']);
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `node --test backend/sockets/games/f1GameSocket.parcoChiuso.test.js`
Expected: FAIL — `physics.applicaPenalitaGriglia is not a function`.

- [ ] **Step 3: Scrivere la funzione**

A livello di modulo in `backend/sockets/games/f1GameSocket.js`:

```js
// La penalita' in griglia: chi ha sostituito oltre la dotazione arretra di N
// posizioni sulla griglia della gara successiva.
//
// Quando piu' piloti sono penalizzati si applica PRIMA la penalita' piu'
// grande, come nella F1 vera: senza un ordine dichiarato il risultato
// dipenderebbe da come e' scritto un ciclo, e "come capita" in un campionato
// vuol dire che la griglia cambia a seconda del giorno.
//
// Chi sfora oltre l'ultima piazzola si ferma all'ultima.
function applicaPenalitaGriglia(ordine, penalitaPerColore) {
    const penalizzati = Object.keys(penalitaPerColore || {})
        .filter(c => (penalitaPerColore[c] || 0) > 0 && ordine.indexOf(c) >= 0)
        .sort((a, b) => penalitaPerColore[b] - penalitaPerColore[a]);

    const out = ordine.slice();
    for (const colore of penalizzati) {
        const da = out.indexOf(colore);
        if (da < 0) continue;
        out.splice(da, 1);
        const a = Math.min(out.length, da + penalitaPerColore[colore]);
        out.splice(a, 0, colore);
    }
    return out;
}
```

- [ ] **Step 4: Applicarla dopo la qualifica**

In `endQualifying` (riga ~1236):

```js
    // La griglia e' il risultato della qualifica, PIU' le penalita' del parco
    // chiuso: "hai fatto la pole e parti terzo" e' un momento di scena che la
    // sequenza qualifica → griglia offre gratis, e va alimentato qui — prima
    // che il pannello della griglia venga costruito, non dopo.
    game.grid = applicaPenalitaGriglia(
        ranked.map(p => p.color),
        (lobbies.get(lobbyId) || {}).gameSettings?.penalitaGriglia || {}
    );
```

⚠️ Verificare come `endQualifying` accede alla lobby: se non ha `lobbyId` sottomano, passare la mappa delle penalità dentro `game` al momento del join, insieme a `usuraStagione`. **Non** aggiungere un secondo modo di leggere le impostazioni.

- [ ] **Step 5: La penalità viaggia con le impostazioni**

In `backend/sockets/games/f1Stagione.server.js`, accanto a `usuraStagione`:

```js
        // Quante posizioni perde ognuno sulla griglia di QUESTA gara, per
        // colore. Calcolata qui una volta: il weekend non deve rileggere la
        // stagione da Mongo per saperlo.
        penalitaGriglia: (stagione.piloti || []).reduce((acc, p) => {
            const n = F1Stagione.penalitaGriglia(stagione, p.id);
            if (p.colore && n > 0) acc[p.colore] = n;
            return acc;
        }, {}),
```

- [ ] **Step 6: Eseguire i test e verificare che passino**

Run: `node --test backend/sockets/games/f1GameSocket.parcoChiuso.test.js`
Expected: PASS.

- [ ] **Step 7: Verificare tutta la suite**

Run: `node --test backend/ 2>&1 | grep "^not ok"`
Expected: lo stesso elenco del Task 1 Step 1.

⚠️ Attenzione a `f1GameSocket.sequenzaGriglia.test.js` e `f1GameSocket.gridSpawn.test.js`: senza penalità l'ordine deve restare identico a prima.

- [ ] **Step 8: Commit**

```bash
git add backend/sockets/games/f1GameSocket.js backend/sockets/games/f1Stagione.server.js backend/sockets/games/f1GameSocket.parcoChiuso.test.js
git commit -m "La penalita' in griglia

'Hai fatto la pole e parti terzo': si applica dopo la qualifica, prima
che la griglia venga costruita. E' un momento di scena che la sequenza
qualifica → griglia offre gratis.

Con piu' penalizzati si applica prima la penalita' piu' grande, come
nella F1 vera: senza un ordine dichiarato la griglia dipenderebbe da
come e' scritto un ciclo.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Il playtest che chiude la fase

Nessun test automatico può dire se la tensione funziona. Serve una stagione da sei gare, giocata:

1. **Prima gara**: la macchina è nuova. Alla fine, l'officina si apre e non c'è ancora niente da sostituire.
2. **Terza gara**: il motore deve essere sopra il 90% e la scelta deve *pesare* — sostituire ora e partire indietro, o tirare avanti con una macchina più lenta.
3. **Chiudere il browser in officina** e riaprire la stagione: si deve tornare in officina, con la gara appena corsa già registrata.
4. **Una qualifica con penalità in corso**: fare la pole e vedersi assegnare la terza casella.
5. **I bot**: nel calendario devono comparire rivali penalizzati anche loro, non solo il giocatore.

Se al punto 2 la scelta è ovvia in un senso o nell'altro, i numeri da toccare sono `DOTAZIONE_OGNI_N_GARE` e `USURA_MOTORE_PER_GARA` — non le penalità.

## Cosa resta fuori, anche qui

- **Ogni umano decide per sé** in multigiocatore (vedi la nota nel Task 7): in questa versione l'officina la fa chi ospita.
- **Soldi, budget, componenti nuove, differenziazione dei bot per difficoltà**: fuori, come da spec.
