# Segnalazioni in gioco (tasto M) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** premendo `M` durante una gara F1, la posizione dell'auto e la direzione in cui guarda finiscono in un file JSON, così i difetti visti in playtest si localizzano senza misurare a tappeto tutto il circuito.

**Architettura:** un modulo puro condiviso compone il record (nessuna dipendenza da Three o dal DOM, quindi testabile con `node --test`); una route di sviluppo lo appende a un file tramite uno store isolato; un tool da riga di comando rilegge il file e dice, per ogni punto, dove sei sulla pista e quali oggetti di scenografia avevi intorno. Client e server non condividono stato: il progressivo di ogni segnalazione lo assegna il server ed è quello che il client mostra a schermo.

**Tech stack:** JS vanilla lato frontend (moduli UMD in `frontend/shared/`), Node + Express lato backend, test con `node:test` e `node:assert/strict`.

Spec: `docs/superpowers/specs/2026-08-12-f1-segnalazioni-in-gioco-design.md`

## Global Constraints

- **Si lavora nel worktree `.claude/worktrees/f1-ghiaia`, branch `f1-ghiaia`.** Non su `main`. Tutti i percorsi in questo piano sono relativi alla radice del worktree.
- **Italiano** nei commenti del codice, nei messaggi a schermo e nei messaggi di commit.
- **Niente emoji nell'UI del gioco.** Sulla console del server sono ammesse (c'è già `🗺` in `/dev/minimap`).
- **Test:** `node --test <file>` dalla radice del worktree. Non esiste altro runner. Node in uso: **v20.13.1**, quindi `fetch` globale è disponibile nei test e i moduli UMD di `frontend/shared/` si caricano con `require()` (verificato su `trackScenery.js` e `trackGeometry.js`).
- **Un commit per task**, come da preferenza dell'utente. **Mai `git push`**: lo fa l'utente a mano.
- **Cache-busting:** ogni modifica a un `.js` o `.css` del frontend richiede il bump del `?v=` nel tag corrispondente in `frontend/f1.html`. Senza, il browser serve la versione vecchia e sembra che la feature non funzioni.
- **Le route nuove vivono solo fuori produzione**, dentro il blocco `if (process.env.NODE_ENV !== 'production')` già presente in `backend/server.js:25`.
- **Convenzione angoli del gioco:** `rotY = atan2(tangente.x, tangente.z)` — 0 guarda verso `+Z`, cresce verso `+X` (commento in `frontend/shared/trackScenery.js:917`). Non inventarne un'altra: il tool di lettura confronta questi angoli con tangenti calcolate con lo stesso `atan2`.

## File Structure

| File | Responsabilità |
|---|---|
| `frontend/shared/f1Segnalazioni.js` (nuovo) | Compone il record: conversione angolo, arrotondamenti, id di sessione. Puro. |
| `frontend/shared/f1Segnalazioni.test.js` (nuovo) | Test del modulo puro. |
| `backend/dev/segnalazioniStore.js` (nuovo) | Legge/scrive/valida il file JSON, assegna il progressivo, annulla l'ultima. |
| `backend/dev/segnalazioniStore.test.js` (nuovo) | Test dello store su file temporanei. |
| `backend/dev/segnalazioniRoutes.js` (nuovo) | Le due route HTTP, sottili: validano il minimo e delegano allo store. |
| `backend/dev/segnalazioniRoutes.test.js` (nuovo) | Test delle route su un'istanza Express usa e getta. |
| `backend/server.js` (modifica) | Registra le route dentro il blocco già esistente non-produzione. |
| `frontend/f1.js` (modifica) | Tasto `M`/`Shift+M`, invio, messaggio a schermo. |
| `frontend/f1.html` (modifica) | Nuovo tag script, elemento del messaggio, bump dei `?v=`. |
| `frontend/styles/f1.css` (modifica) | Stile del messaggio. |
| `backend/tools/f1-segnalazioni.js` (nuovo) | Tool di lettura: geometria di pista (Task 5) e scenografia vicina (Task 6). |
| `backend/tools/f1-segnalazioni.test.js` (nuovo) | Test delle funzioni pure del tool. |
| `.gitignore` (modifica) | Ignora `backend/tools/f1-segnalazioni.json`. |
| `docs/f1-notes.md` (modifica) | Come si usa il sistema. |

---

### Task 1: Modulo puro che compone la segnalazione

**Files:**
- Create: `frontend/shared/f1Segnalazioni.js`
- Test: `frontend/shared/f1Segnalazioni.test.js`

**Interfaces:**
- Consumes: niente.
- Produces:
  - `gradiDaRotY(rotY: number) → number` in `[0, 360)`
  - `nuovaSessioneId(now: Date, rnd: () => number) → string` formato `AAAAMMGG-hhmmss-xxx`
  - `componiSegnalazione(stato) → record` dove `stato = { sessione, t, trackId, pos: {x,y,z}, rotY, camera, guardaDietro, velocita, giro }` e il record ha le stesse chiavi con `headingDeg` al posto di `rotY`, **senza** `n`.

- [ ] **Step 1: Scrivi il test che fallisce**

Crea `frontend/shared/f1Segnalazioni.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const F1Segnalazioni = require('./f1Segnalazioni.js');

const STATO = {
    sessione: '20260812-141230-abc',
    t: '2026-08-12T14:12:41.310Z',
    trackId: 'prova',
    pos: { x: 123.456, y: 2.109, z: -88.702 },
    rotY: Math.PI / 2,
    camera: 'third',
    guardaDietro: false,
    velocita: 143.7,
    giro: 2
};

test('rotY 0 guarda verso +Z, cioè zero gradi', () => {
    assert.equal(F1Segnalazioni.gradiDaRotY(0), 0);
});

test('un quarto di giro vale 90 gradi', () => {
    assert.equal(Math.round(F1Segnalazioni.gradiDaRotY(Math.PI / 2)), 90);
});

test('gli angoli negativi rientrano in [0,360)', () => {
    assert.equal(Math.round(F1Segnalazioni.gradiDaRotY(-Math.PI / 2)), 270);
});

test('oltre il giro completo si normalizza', () => {
    // rotY arriva dal server e non è limitato a un giro: senza
    // normalizzazione finirebbero nel file angoli come 900°, che non si
    // confrontano con la tangente della pista.
    assert.equal(Math.round(F1Segnalazioni.gradiDaRotY(5 * Math.PI)), 180);
});

test('il record non porta il progressivo: lo assegna il server', () => {
    const rec = F1Segnalazioni.componiSegnalazione(STATO);
    assert.equal('n' in rec, false);
});

test('le coordinate sono arrotondate a due decimali', () => {
    const rec = F1Segnalazioni.componiSegnalazione(STATO);
    assert.deepEqual(rec.pos, { x: 123.46, y: 2.11, z: -88.7 });
});

test('la velocità è quella dell HUD, intera', () => {
    const rec = F1Segnalazioni.componiSegnalazione(STATO);
    assert.equal(rec.velocita, 144);
});

test('il giro ignoto diventa null, non zero', () => {
    // Zero è un giro valido (prima del traguardo): confonderlo con
    // "non lo so" renderebbe illeggibile la lista.
    const rec = F1Segnalazioni.componiSegnalazione({ ...STATO, giro: null });
    assert.equal(rec.giro, null);
    assert.equal(F1Segnalazioni.componiSegnalazione({ ...STATO, giro: 0 }).giro, 0);
});

test('l id di sessione contiene data, ora e una coda casuale', () => {
    const id = F1Segnalazioni.nuovaSessioneId(new Date(2026, 7, 12, 14, 12, 30), () => 0.5);
    assert.match(id, /^20260812-141230-[0-9a-z]{3}$/);
});
```

- [ ] **Step 2: Lancia il test e verifica che fallisca**

Run: `node --test frontend/shared/f1Segnalazioni.test.js`
Expected: FAIL — `Cannot find module './f1Segnalazioni.js'`

- [ ] **Step 3: Scrivi il modulo**

Crea `frontend/shared/f1Segnalazioni.js`:

```js
// frontend/shared/f1Segnalazioni.js
//
// Composizione del record di una segnalazione in gioco (tasto M): dove sta
// l'auto e dove sta guardando, per poter localizzare in fretta i difetti
// scenografici visti in playtest.
//
// Modulo puro — niente Three, niente DOM, niente fetch — così la conversione
// dell'angolo, che se sbagliata manda a cercare l'oggetto dalla parte opposta
// della pista, è verificabile con `node --test`.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.F1Segnalazioni = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    // Convenzione del gioco per l'angolo di un'auto: atan2(tangente.x,
    // tangente.z), vedi trackScenery.js:917. Zero guarda verso +Z e l'angolo
    // cresce verso +X. Qui si passa solo a gradi: la convenzione non si tocca,
    // perché il tool di lettura confronta questi valori con tangenti calcolate
    // con lo stesso atan2.
    function gradiDaRotY(rotY) {
        const gradi = rotY * 180 / Math.PI;
        return ((gradi % 360) + 360) % 360;
    }

    function arrotonda(valore, decimali) {
        const fattore = Math.pow(10, decimali);
        return Math.round(valore * fattore) / fattore;
    }

    // Distingue i giri di ricognizione fra loro e dà a Shift+M un bersaglio
    // non ambiguo. `rnd` è iniettata (Math.random in gioco) per poter essere
    // deterministica nei test.
    function nuovaSessioneId(now, rnd) {
        const pad = (n, l) => String(n).padStart(l, '0');
        const data = `${now.getFullYear()}${pad(now.getMonth() + 1, 2)}${pad(now.getDate(), 2)}`;
        const ora = `${pad(now.getHours(), 2)}${pad(now.getMinutes(), 2)}${pad(now.getSeconds(), 2)}`;
        const coda = Math.floor(rnd() * 46656).toString(36).padStart(3, '0');   // 36^3
        return `${data}-${ora}-${coda}`;
    }

    // stato: { sessione, t, trackId, pos:{x,y,z}, rotY, camera, guardaDietro,
    //          velocita, giro }
    //
    // Il record esce SENZA `n`: il progressivo lo assegna il server, che è
    // l'unico a vedere il file. Un contatore locale divergerebbe dal file
    // appena si aprono due schede o si ricarica la pagina.
    function componiSegnalazione(stato) {
        return {
            sessione: stato.sessione,
            t: stato.t,
            trackId: stato.trackId,
            pos: {
                x: arrotonda(stato.pos.x, 2),
                y: arrotonda(stato.pos.y, 2),
                z: arrotonda(stato.pos.z, 2)
            },
            headingDeg: arrotonda(gradiDaRotY(stato.rotY), 1),
            camera: stato.camera,
            guardaDietro: !!stato.guardaDietro,
            velocita: Math.round(stato.velocita || 0),
            giro: Number.isFinite(stato.giro) ? stato.giro : null
        };
    }

    return { gradiDaRotY, nuovaSessioneId, componiSegnalazione };
});
```

- [ ] **Step 4: Lancia il test e verifica che passi**

Run: `node --test frontend/shared/f1Segnalazioni.test.js`
Expected: PASS, 9 test

- [ ] **Step 5: Commit**

```bash
git add frontend/shared/f1Segnalazioni.js frontend/shared/f1Segnalazioni.test.js
git commit -m "F1 segnalazioni: modulo puro che compone il record"
```

---

### Task 2: Store del file delle segnalazioni

**Files:**
- Create: `backend/dev/segnalazioniStore.js`
- Test: `backend/dev/segnalazioniStore.test.js`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: il record prodotto da `componiSegnalazione` (Task 1).
- Produces:
  - `leggi(file?) → array` (array vuoto se il file manca o è illeggibile)
  - `aggiungi(rec, file?) → { ok: true, n } | { ok: false, errore }`
  - `annullaUltima(sessione, file?) → { ok: true, n } | { ok: false, errore }`
  - `validaRecord(rec) → null | string` (null = valido, stringa = motivo)
  - costanti `FILE_DEFAULT`, `MAX_RECORD`

- [ ] **Step 1: Scrivi il test che fallisce**

Crea `backend/dev/segnalazioniStore.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('./segnalazioniStore.js');

// File temporaneo per ogni test: lo store scrive davvero su disco, e i test
// non devono toccare il file di lavoro dell'utente.
function fileTemp() {
    return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'segn-')), 'f1-segnalazioni.json');
}

const REC = {
    sessione: 's1', t: '2026-08-12T14:12:41.310Z', trackId: 'prova',
    pos: { x: 1, y: 2, z: 3 }, headingDeg: 90,
    camera: 'third', guardaDietro: false, velocita: 144, giro: 2
};

test('la prima segnalazione crea il file e prende il numero 1', () => {
    const f = fileTemp();
    assert.deepEqual(store.aggiungi(REC, f), { ok: true, n: 1 });
    assert.equal(store.leggi(f).length, 1);
    assert.equal(store.leggi(f)[0].n, 1);
});

test('il progressivo cresce', () => {
    const f = fileTemp();
    store.aggiungi(REC, f);
    assert.deepEqual(store.aggiungi(REC, f), { ok: true, n: 2 });
});

test('un numero mandato dal client non vince su quello del server', () => {
    // Il client non ha titolo per numerare: se lo facesse, due schede aperte
    // scriverebbero due "segnalazione 1" diverse nello stesso file.
    const f = fileTemp();
    store.aggiungi({ ...REC, n: 99 }, f);
    assert.equal(store.leggi(f)[0].n, 1);
});

test('un record senza posizione viene rifiutato e non scrive niente', () => {
    const f = fileTemp();
    const esito = store.aggiungi({ ...REC, pos: { x: 1, y: NaN, z: 3 } }, f);
    assert.equal(esito.ok, false);
    assert.match(esito.errore, /pos/);
    assert.equal(fs.existsSync(f), false);
});

test('un record senza trackId viene rifiutato', () => {
    const f = fileTemp();
    assert.equal(store.aggiungi({ ...REC, trackId: '' }, f).ok, false);
});

test('leggere un file inesistente dà una lista vuota, non un errore', () => {
    assert.deepEqual(store.leggi(path.join(os.tmpdir(), 'non-esiste-mai.json')), []);
});

test('annulla toglie l ultima della sessione indicata e lascia le altre', () => {
    const f = fileTemp();
    store.aggiungi({ ...REC, sessione: 's1' }, f);
    store.aggiungi({ ...REC, sessione: 's2' }, f);
    store.aggiungi({ ...REC, sessione: 's1' }, f);
    assert.deepEqual(store.annullaUltima('s1', f), { ok: true, n: 3 });
    const rimasti = store.leggi(f);
    assert.deepEqual(rimasti.map(r => r.n), [1, 2]);
});

test('annulla su una sessione senza segnalazioni non fa danni', () => {
    const f = fileTemp();
    store.aggiungi(REC, f);
    assert.equal(store.annullaUltima('sconosciuta', f).ok, false);
    assert.equal(store.leggi(f).length, 1);
});

test('oltre il tetto massimo lo store rifiuta invece di gonfiare il file', () => {
    const f = fileTemp();
    const pieni = Array.from({ length: store.MAX_RECORD }, (_, i) => ({ ...REC, n: i + 1 }));
    fs.writeFileSync(f, JSON.stringify(pieni));
    assert.equal(store.aggiungi(REC, f).ok, false);
});
```

- [ ] **Step 2: Lancia il test e verifica che fallisca**

Run: `node --test backend/dev/segnalazioniStore.test.js`
Expected: FAIL — `Cannot find module './segnalazioniStore.js'`

- [ ] **Step 3: Scrivi lo store**

Crea `backend/dev/segnalazioniStore.js`:

```js
// backend/dev/segnalazioniStore.js
//
// Lettura e scrittura del file delle segnalazioni in gioco (tasto M).
// Separato dalle route perché la parte che può corrompere il file —
// validazione, progressivo, annullamento — dev'essere verificabile con
// `node --test` senza avviare un server.
const fs = require('fs');
const path = require('path');

const FILE_DEFAULT = path.join(__dirname, '..', 'tools', 'f1-segnalazioni.json');

// Tetto di sicurezza: l'autorepeat del tasto o uno script impazzito non
// devono far crescere il file all'infinito.
const MAX_RECORD = 500;

function leggi(file = FILE_DEFAULT) {
    try {
        const dati = JSON.parse(fs.readFileSync(file, 'utf8'));
        return Array.isArray(dati) ? dati : [];
    } catch (err) {
        return [];   // file assente o illeggibile: si riparte da zero
    }
}

function scrivi(file, records) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(records, null, 2) + '\n');
}

function numeroFinito(v) { return typeof v === 'number' && Number.isFinite(v); }

// Restituisce null se il record va bene, altrimenti il motivo del rifiuto.
function validaRecord(rec) {
    if (!rec || typeof rec !== 'object') return 'record mancante';
    if (typeof rec.trackId !== 'string' || !rec.trackId || rec.trackId.length > 64) return 'trackId non valido';
    if (typeof rec.sessione !== 'string' || !rec.sessione || rec.sessione.length > 64) return 'sessione non valida';
    if (!rec.pos || !numeroFinito(rec.pos.x) || !numeroFinito(rec.pos.y) || !numeroFinito(rec.pos.z)) return 'pos non valida';
    if (!numeroFinito(rec.headingDeg)) return 'headingDeg non valido';
    return null;
}

function aggiungi(rec, file = FILE_DEFAULT) {
    const errore = validaRecord(rec);
    if (errore) return { ok: false, errore };
    const records = leggi(file);
    if (records.length >= MAX_RECORD) return { ok: false, errore: `raggiunte ${MAX_RECORD} segnalazioni` };
    const n = records.reduce((max, r) => Math.max(max, r.n || 0), 0) + 1;
    // `n` DOPO lo spread: se il client ne manda uno suo, non deve vincere.
    const { n: _ignorato, ...pulito } = rec;
    records.push({ n, ...pulito });
    scrivi(file, records);
    return { ok: true, n };
}

function annullaUltima(sessione, file = FILE_DEFAULT) {
    const records = leggi(file);
    for (let i = records.length - 1; i >= 0; i--) {
        if (records[i].sessione === sessione) {
            const n = records[i].n;
            records.splice(i, 1);
            scrivi(file, records);
            return { ok: true, n };
        }
    }
    return { ok: false, errore: 'niente da annullare' };
}

module.exports = { leggi, aggiungi, annullaUltima, validaRecord, FILE_DEFAULT, MAX_RECORD };
```

- [ ] **Step 4: Lancia il test e verifica che passi**

Run: `node --test backend/dev/segnalazioniStore.test.js`
Expected: PASS, 9 test

- [ ] **Step 5: Ignora il file di lavoro**

In `.gitignore`, sotto la riga `backend/tools/*-telemetry.json`, aggiungi:

```
# Segnalazioni raccolte in gioco col tasto M (materiale di lavoro, non sorgente)
backend/tools/f1-segnalazioni.json
```

- [ ] **Step 6: Commit**

```bash
git add backend/dev/segnalazioniStore.js backend/dev/segnalazioniStore.test.js .gitignore
git commit -m "F1 segnalazioni: store del file, con progressivo e annullamento"
```

---

### Task 3: Route di sviluppo

**Files:**
- Create: `backend/dev/segnalazioniRoutes.js`
- Test: `backend/dev/segnalazioniRoutes.test.js`
- Modify: `backend/server.js` (dentro il blocco `NODE_ENV !== 'production'`, che finisce a riga 46)

**Interfaces:**
- Consumes: `segnalazioniStore` (Task 2).
- Produces:
  - `registra(app, file?)` — monta `POST /dev/f1-marker` e `POST /dev/f1-marker/annulla` su un'app Express.
  - `POST /dev/f1-marker` — corpo: il record di Task 1. Risposta `200 { ok: true, n }` oppure `400 { ok: false, errore }`.
  - `POST /dev/f1-marker/annulla` — corpo: `{ sessione }`. Risposta `200 { ok: true, n }` oppure `200 { ok: false, errore }` se non c'era niente da annullare, `400` se manca `sessione`.

- [ ] **Step 1: Scrivi il test che fallisce**

Crea `backend/dev/segnalazioniRoutes.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { registra } = require('./segnalazioniRoutes.js');

const REC = {
    sessione: 's1', t: '2026-08-12T14:12:41.310Z', trackId: 'prova',
    pos: { x: 1, y: 2, z: 3 }, headingDeg: 90,
    camera: 'third', guardaDietro: false, velocita: 144, giro: 2
};

// Server usa e getta su porta effimera: la route va provata come la userà il
// browser, non chiamando a mano il gestore.
function avvia() {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'segn-')), 'segnalazioni.json');
    const app = express();
    registra(app, file);
    return new Promise(resolve => {
        const srv = app.listen(0, '127.0.0.1', () => {
            resolve({ srv, file, url: `http://127.0.0.1:${srv.address().port}` });
        });
    });
}

function posta(url, corpo) {
    return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo)
    });
}

test('una segnalazione valida viene salvata e risponde col numero', async () => {
    const { srv, url, file } = await avvia();
    try {
        const r = await posta(`${url}/dev/f1-marker`, REC);
        assert.equal(r.status, 200);
        assert.deepEqual(await r.json(), { ok: true, n: 1 });
        assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).length, 1);
    } finally { srv.close(); }
});

test('un payload malformato risponde 400 e non scrive', async () => {
    const { srv, url, file } = await avvia();
    try {
        const r = await posta(`${url}/dev/f1-marker`, { ...REC, pos: null });
        assert.equal(r.status, 400);
        assert.equal((await r.json()).ok, false);
        assert.equal(fs.existsSync(file), false);
    } finally { srv.close(); }
});

test('annulla toglie l ultima della sessione', async () => {
    const { srv, url, file } = await avvia();
    try {
        await posta(`${url}/dev/f1-marker`, REC);
        await posta(`${url}/dev/f1-marker`, REC);
        const r = await posta(`${url}/dev/f1-marker/annulla`, { sessione: 's1' });
        assert.deepEqual(await r.json(), { ok: true, n: 2 });
        assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).length, 1);
    } finally { srv.close(); }
});

test('annulla senza sessione risponde 400', async () => {
    const { srv, url } = await avvia();
    try {
        const r = await posta(`${url}/dev/f1-marker/annulla`, {});
        assert.equal(r.status, 400);
    } finally { srv.close(); }
});
```

- [ ] **Step 2: Lancia il test e verifica che fallisca**

Run: `node --test backend/dev/segnalazioniRoutes.test.js`
Expected: FAIL — `Cannot find module './segnalazioniRoutes.js'`

- [ ] **Step 3: Scrivi le route**

Crea `backend/dev/segnalazioniRoutes.js`:

```js
// backend/dev/segnalazioniRoutes.js
//
// Route di sviluppo per le segnalazioni in gioco (tasto M). Registrate solo
// fuori produzione da server.js, come /dev/minimap. Sottili per scelta: la
// logica sta nello store, che è testabile senza rete.
const express = require('express');
const store = require('./segnalazioniStore');

function registra(app, file = store.FILE_DEFAULT) {
    // Parser locale: le route stanno PRIMA dei parser globali di server.js,
    // esattamente come /dev/minimap. 32kb sono un'abbondanza per un record
    // che ne pesa meno di uno.
    app.post('/dev/f1-marker', express.json({ limit: '32kb' }), (req, res) => {
        const esito = store.aggiungi(req.body, file);
        if (!esito.ok) return res.status(400).json(esito);
        const { trackId, pos } = req.body;
        console.log(`📍 Segnalazione ${esito.n} — ${trackId} (${pos.x}, ${pos.z})`);
        res.json(esito);
    });

    app.post('/dev/f1-marker/annulla', express.json({ limit: '4kb' }), (req, res) => {
        const sessione = req.body && req.body.sessione;
        if (typeof sessione !== 'string' || !sessione) {
            return res.status(400).json({ ok: false, errore: 'sessione mancante' });
        }
        const esito = store.annullaUltima(sessione, file);
        if (esito.ok) console.log(`📍 Segnalazione ${esito.n} annullata`);
        res.json(esito);
    });
}

module.exports = { registra };
```

- [ ] **Step 4: Lancia il test e verifica che passi**

Run: `node --test backend/dev/segnalazioniRoutes.test.js`
Expected: PASS, 4 test

- [ ] **Step 5: Aggancia le route al server**

In `backend/server.js`, dentro il blocco `if (process.env.NODE_ENV !== 'production') { … }` che inizia a riga 25, subito **dopo** la chiusura della route `/dev/minimap` (riga 45, la `});`) e **prima** della graffa che chiude il blocco:

```js
    // Segnalazioni in gioco (tasto M): stesso spirito di /dev/minimap, un
    // canale di sviluppo che scrive un file di lavoro. Mai in produzione.
    require('./dev/segnalazioniRoutes').registra(app);
```

- [ ] **Step 6: Verifica a mano che il server risponda**

Avvia il server: `node backend/server.js`
In un altro terminale:

```bash
curl -s -X POST http://localhost:3000/dev/f1-marker -H "Content-Type: application/json" \
  -d '{"sessione":"prova-curl","t":"2026-08-12T00:00:00.000Z","trackId":"prova","pos":{"x":1,"y":0,"z":2},"headingDeg":45,"camera":"third","guardaDietro":false,"velocita":0,"giro":0}'
curl -s -X POST http://localhost:3000/dev/f1-marker/annulla -H "Content-Type: application/json" -d '{"sessione":"prova-curl"}'
```

Expected: `{"ok":true,"n":1}` poi `{"ok":true,"n":1}`. Il file `backend/tools/f1-segnalazioni.json` resta un array vuoto. Ferma il server.

- [ ] **Step 7: Commit**

```bash
git add backend/dev/segnalazioniRoutes.js backend/dev/segnalazioniRoutes.test.js backend/server.js
git commit -m "F1 segnalazioni: route dev per salvare e annullare"
```

---

### Task 4: Il tasto M in gioco

**Files:**
- Modify: `frontend/f1.js` (stato a ~riga 758, `setLapDisplay` a riga 846, keydown a riga 1968)
- Modify: `frontend/f1.html` (elemento del messaggio, tag script, bump `?v=`)
- Modify: `frontend/styles/f1.css` (stile del messaggio)

**Interfaces:**
- Consumes: `F1Segnalazioni.componiSegnalazione` e `nuovaSessioneId` (Task 1, globale `window.F1Segnalazioni`); `POST /dev/f1-marker` e `/annulla` (Task 3).
- Produces: niente per gli altri task. La verifica è dell'utente in localhost.

- [ ] **Step 1: Aggiungi l'elemento del messaggio in f1.html**

Subito dopo il pannello `debug-panel` (l'elemento che inizia a riga 100), aggiungi:

```html
    <!-- Segnalazioni in gioco (M / Shift+M): conferma che il punto è stato
         salvato, col numero assegnato dal server. -->
    <div class="hud f1-panel hud-segnalazione" id="segnalazione-avviso" style="display:none;"></div>
```

- [ ] **Step 2: Carica il modulo e bumpa le versioni in f1.html**

Aggiungi il tag script **prima** di `f1.js` (riga 261), accanto agli altri moduli condivisi:

```html
    <script src="shared/f1Segnalazioni.js?v=20260812a"></script>
```

Poi bumpa i due `?v=` toccati da questo task:
- riga 9: `./styles/f1.css?v=20260807d` → `?v=20260812a`
- riga 261: `f1.js?v=20260812a` → `?v=20260812b`

- [ ] **Step 3: Stile del messaggio in styles/f1.css**

In fondo a `frontend/styles/f1.css`:

```css
/* Avviso delle segnalazioni in gioco (M / Shift+M). In alto al centro, dove
   non copre né la classifica (in alto a sinistra) né il pannello
   timer/velocità (in basso). Niente emoji: solo testo, come il resto dell'UI. */
.hud-segnalazione {
    position: absolute;
    top: 24px;
    left: 50%;
    transform: translateX(-50%);
    padding: 10px 18px;
    font-weight: 600;
    letter-spacing: 0.02em;
    white-space: nowrap;
    pointer-events: none;
    z-index: 40;
}

.hud-segnalazione.segnalazione-errore {
    color: #ff6b6b;
}
```

- [ ] **Step 4: Stato e aggancio del giro corrente in f1.js**

Accanto alle altre variabili di stato della camera (riga 758, `let cameraMode = 'third';`), aggiungi:

```js
    // ── Segnalazioni in gioco (M / Shift+M) ────────────────────────────
    // Un id per ogni caricamento della pagina: tiene separati i giri di
    // ricognizione e dà a Shift+M un bersaglio non ambiguo.
    const sessioneSegnalazioni = F1Segnalazioni.nuovaSessioneId(new Date(), Math.random);
    // Ultimo giro noto, per annotare la segnalazione. null = non ancora saputo.
    let giroCorrente = null;
```

Dentro `setLapDisplay` (riga 846), come **prima** riga del corpo:

```js
        giroCorrente = completedLaps;   // unico punto in cui il giro cambia: lo intercetta anche per le segnalazioni
```

- [ ] **Step 5: Funzioni di registrazione e annullamento in f1.js**

Subito **prima** di `function isTypingInField(e)` (riga 1961), aggiungi:

```js
    // Mostra l'esito per un attimo e poi sparisce. Un solo timer: due
    // pressioni ravvicinate non devono lasciare il messaggio appeso.
    let timerAvvisoSegnalazione = null;
    function mostraAvvisoSegnalazione(testo, errore) {
        const el = document.getElementById('segnalazione-avviso');
        if (!el) return;
        el.textContent = testo;
        el.classList.toggle('segnalazione-errore', !!errore);
        el.style.display = 'block';
        clearTimeout(timerAvvisoSegnalazione);
        timerAvvisoSegnalazione = setTimeout(() => { el.style.display = 'none'; }, 1500);
    }

    // Registra dove sei e dove stai guardando. Il numero mostrato è quello
    // che il SERVER ha scritto nel file: così il "terzo punto" di cui si
    // parla dopo in chat è lo stesso record per tutti e due.
    async function registraSegnalazione() {
        if (!myCarGroup) return;
        const stato = serverState[myColor];
        const rec = F1Segnalazioni.componiSegnalazione({
            sessione: sessioneSegnalazioni,
            t: new Date().toISOString(),
            trackId,
            pos: myCarGroup.position,
            rotY: myCarGroup.rotation.y,
            camera: cameraMode,
            guardaDietro: isLookingBack(),
            // Stessa conversione dell'HUD (speedEl, in animate): il valore
            // nel file dev'essere quello che il giocatore aveva sotto gli occhi.
            velocita: Math.abs((stato && stato.speed) || 0) * 55,
            giro: giroCorrente
        });
        try {
            const risposta = await fetch('/dev/f1-marker', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(rec)
            });
            const esito = await risposta.json();
            if (esito.ok) mostraAvvisoSegnalazione(`Segnalazione ${esito.n} registrata`);
            else mostraAvvisoSegnalazione('Segnalazione NON salvata', true);
        } catch (err) {
            // Mai una conferma falsa: se il server non ha risposto, il punto
            // non esiste e chi guida deve saperlo subito, non dopo il giro.
            mostraAvvisoSegnalazione('Segnalazione NON salvata', true);
        }
    }

    async function annullaUltimaSegnalazione() {
        try {
            const risposta = await fetch('/dev/f1-marker/annulla', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessione: sessioneSegnalazioni })
            });
            const esito = await risposta.json();
            if (esito.ok) mostraAvvisoSegnalazione(`Segnalazione ${esito.n} annullata`);
            else mostraAvvisoSegnalazione('Niente da annullare', true);
        } catch (err) {
            mostraAvvisoSegnalazione('Annullamento NON riuscito', true);
        }
    }
```

- [ ] **Step 6: Aggancia il tasto**

Nel `keydown` (riga 1968), subito dopo la riga `if (k === 'h') { … }` e prima di `applyKeys();`:

```js
        // M segnala il punto in cui sei, Shift+M annulla l'ultima. `e.repeat`
        // esclude l'autorepeat: tenendo premuto si riempirebbe il file di
        // copie dello stesso punto.
        if (k === 'm' && !e.repeat && !isTypingInField(e)) {
            if (e.shiftKey) annullaUltimaSegnalazione();
            else registraSegnalazione();
        }
```

- [ ] **Step 7: Verifica dell'utente in localhost**

Avvia il server dal worktree (`node backend/server.js`), apri `localhost:3000`, entra in una gara F1 e **fai un hard refresh** (Ctrl+F5) prima di provare.

Chiedi all'utente di:
1. premere `M` in tre punti diversi e confermare che compare "Segnalazione 1/2/3 registrata";
2. premere `Shift+M` una volta e confermare che compare "Segnalazione 3 annullata".

Poi verifica tu il file:

```bash
cat backend/tools/f1-segnalazioni.json
```

Expected: due record, `n` 1 e 2, con `trackId` giusto, `pos` plausibili e `headingDeg` in `[0,360)`.

**Non proseguire senza l'ok dell'utente su questo step.**

- [ ] **Step 8: Commit**

```bash
git add frontend/f1.js frontend/f1.html frontend/styles/f1.css
git commit -m "F1 segnalazioni: tasto M in gioco, con conferma a schermo"
```

---

### Task 5: Tool di lettura — dove sei sulla pista

**Files:**
- Create: `backend/tools/f1-segnalazioni.js`
- Test: `backend/tools/f1-segnalazioni.test.js`

**Interfaces:**
- Consumes: `store.leggi` (Task 2); `TrackGeometry` (`frontend/shared/trackGeometry.js`, modulo UMD già usato in Node); `loadTrack` (`backend/sockets/games/trackLoader.js`) che restituisce `{ points, roadHalf, barrierProfile, pitLanePts, … }`.
- Produces:
  - `descriviPuntoPista(trackPts, roadHalf, rec) → { indice, progressione, distanzaAsse, dentroPista }` — `progressione` in percentuale del giro (0-100), `distanzaAsse` in unità.
  - `direzioneRelativa(headingDeg, gradiVersoOggetto) → string` fra `'davanti'`, `'avanti a destra'`, `'a destra'`, `'dietro a destra'`, `'dietro'`, `'dietro a sinistra'`, `'a sinistra'`, `'avanti a sinistra'`.
  - CLI: `node backend/tools/f1-segnalazioni.js`

- [ ] **Step 1: Scrivi il test che fallisce**

Crea `backend/tools/f1-segnalazioni.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const tool = require('./f1-segnalazioni.js');

// Anello quadrato di comodo: 40 campioni su un giro di lato 100, così la
// progressione e la distanza dall'asse hanno valori a mente.
function anelloDiProva() {
    const pts = [];
    for (let i = 0; i < 40; i++) {
        const t = i / 40, lato = Math.floor(t * 4), u = (t * 4) % 1;
        if (lato === 0) pts.push({ x: -50 + u * 100, y: 0, z: -50 });
        else if (lato === 1) pts.push({ x: 50, y: 0, z: -50 + u * 100 });
        else if (lato === 2) pts.push({ x: 50 - u * 100, y: 0, z: 50 });
        else pts.push({ x: -50, y: 0, z: 50 - u * 100 });
    }
    return pts;
}

test('un punto sull asse risulta dentro pista, a distanza zero', () => {
    const d = tool.descriviPuntoPista(anelloDiProva(), 10, { pos: { x: 0, y: 0, z: -50 } });
    assert.equal(d.dentroPista, true);
    assert.ok(d.distanzaAsse < 0.001);
});

test('un punto oltre il bordo risulta fuori pista', () => {
    // roadHalf 10: a 25 unità dall asse si è fuori di sicuro.
    const d = tool.descriviPuntoPista(anelloDiProva(), 10, { pos: { x: 0, y: 0, z: -75 } });
    assert.equal(d.dentroPista, false);
    assert.ok(Math.abs(d.distanzaAsse - 25) < 0.001);
});

test('la progressione dice a che punto del giro sei', () => {
    // L'angolo a metà anello (50, 50) è esattamente il campione 20 su 40.
    const d = tool.descriviPuntoPista(anelloDiProva(), 10, { pos: { x: 50, y: 0, z: 50 } });
    assert.equal(d.indice, 20);
    assert.equal(d.progressione, 50);
});

test('un oggetto nella stessa direzione del muso è davanti', () => {
    assert.equal(tool.direzioneRelativa(90, 90), 'davanti');
});

test('un oggetto a 180 gradi dal muso è dietro', () => {
    assert.equal(tool.direzioneRelativa(90, 270), 'dietro');
});

test('la destra è la destra del pilota, non quella della mappa', () => {
    // Convenzione del gioco: rotY cresce verso +X, quindi un angolo MAGGIORE
    // del muso sta alla destra di chi guida.
    assert.equal(tool.direzioneRelativa(0, 90), 'a destra');
    assert.equal(tool.direzioneRelativa(0, 270), 'a sinistra');
});
```

- [ ] **Step 2: Lancia il test e verifica che fallisca**

Run: `node --test backend/tools/f1-segnalazioni.test.js`
Expected: FAIL — `Cannot find module './f1-segnalazioni.js'`

- [ ] **Step 3: Scrivi il tool**

Crea `backend/tools/f1-segnalazioni.js`:

```js
// backend/tools/f1-segnalazioni.js
//
// Rilegge le segnalazioni raccolte in gioco col tasto M e le stampa in
// ordine, dicendo per ognuna dove sei sulla pista. Serve a passare da "una
// tribuna è messa male" a un oggetto preciso con le sue coordinate, senza
// misurare a tappeto tutto il circuito.
//
// Uso:  node backend/tools/f1-segnalazioni.js
const path = require('path');
const store = require('../dev/segnalazioniStore');
const TrackGeometry = require('../../frontend/shared/trackGeometry.js');
const { loadTrack } = require('../sockets/games/trackLoader');

// Dove sei rispetto alla pista: campione più vicino, quanto sei avanti nel
// giro, quanto sei lontano dall'asse e se sei ancora sull'asfalto.
function descriviPuntoPista(trackPts, roadHalf, rec) {
    const vicino = TrackGeometry.nearestPoint(trackPts, rec.pos.x, rec.pos.z);
    return {
        indice: vicino.index,
        progressione: Math.round(vicino.index / trackPts.length * 1000) / 10,
        distanzaAsse: Math.round(vicino.dist * 100) / 100,
        dentroPista: vicino.dist <= roadHalf
    };
}

const SETTORI = ['davanti', 'avanti a destra', 'a destra', 'dietro a destra',
                 'dietro', 'dietro a sinistra', 'a sinistra', 'avanti a sinistra'];

// Dove cade un oggetto rispetto al muso dell'auto. Convenzione del gioco:
// rotY cresce verso +X, quindi un angolo maggiore di quello del muso sta
// alla DESTRA di chi guida.
function direzioneRelativa(headingDeg, gradiVersoOggetto) {
    const delta = (((gradiVersoOggetto - headingDeg) % 360) + 360) % 360;
    return SETTORI[Math.round(delta / 45) % 8];
}

function gradiVerso(da, a) {
    const g = Math.atan2(a.x - da.x, a.z - da.z) * 180 / Math.PI;
    return ((g % 360) + 360) % 360;
}

function stampa(file) {
    const records = store.leggi(file);
    if (!records.length) {
        console.log('Nessuna segnalazione. Il file è vuoto o non esiste ancora.');
        return;
    }
    let ultimoTrack = null, track = null;
    for (const rec of records) {
        if (rec.trackId !== ultimoTrack) {
            track = loadTrack(rec.trackId);
            ultimoTrack = rec.trackId;
            console.log(`\n=== ${track.name} (${rec.trackId}) ===`);
        }
        const d = descriviPuntoPista(track.points, track.roadHalf, rec);
        const dove = d.dentroPista ? 'in pista' : `fuori pista, ${d.distanzaAsse} dall'asse`;
        const giro = rec.giro === null ? 'giro ignoto' : `giro ${rec.giro}`;
        console.log(`\n[${rec.n}] ${dove} — ${d.progressione}% del giro (campione ${d.indice})`);
        console.log(`     posizione  x=${rec.pos.x} y=${rec.pos.y} z=${rec.pos.z}`);
        console.log(`     muso ${rec.headingDeg}°, ${rec.velocita} km/h, ${giro}, camera ${rec.camera}${rec.guardaDietro ? ' (guardava dietro)' : ''}`);
    }
    console.log('');
}

if (require.main === module) stampa(store.FILE_DEFAULT);

module.exports = { descriviPuntoPista, direzioneRelativa, gradiVerso, stampa };
```

- [ ] **Step 4: Lancia il test e verifica che passi**

Run: `node --test backend/tools/f1-segnalazioni.test.js`
Expected: PASS, 6 test

- [ ] **Step 5: Provalo sui dati veri**

Run: `node backend/tools/f1-segnalazioni.js`
Expected: le segnalazioni lasciate dall'utente nel Task 4, in ordine, ciascuna con percentuale di giro e posizione. Confronta a occhio: una segnalazione fatta stando fermi in pista deve dire "in pista".

- [ ] **Step 6: Commit**

```bash
git add backend/tools/f1-segnalazioni.js backend/tools/f1-segnalazioni.test.js
git commit -m "F1 segnalazioni: tool di lettura, posizione sulla pista"
```

---

### Task 6: Tool di lettura — cosa avevi intorno

**Files:**
- Modify: `backend/tools/f1-segnalazioni.js`
- Modify: `backend/tools/f1-segnalazioni.test.js`
- Modify: `docs/f1-notes.md`

**Interfaces:**
- Consumes: `TrackScenery.generateLayout` (`frontend/shared/trackScenery.js:1091`), le voci del layout hanno forma `{ asset, category, x, y, z, rotY, … }`.
- Produces: `vicini(layout, rec, quanti) → array di { asset, category, distanza, direzione }` ordinato per distanza crescente.

**Perché è un task a sé:** ricostruire il layout in Node è l'unico punto del progetto che può sbagliare in silenzio. Se anche uno dei sette argomenti di `generateLayout` non coincide con quello del client, il tool stampa nomi di oggetti che il giocatore non aveva davanti. Lo Step 4 esiste apposta per smascherarlo.

- [ ] **Step 1: Scrivi il test che fallisce**

Aggiungi in fondo a `backend/tools/f1-segnalazioni.test.js`:

```js
test('i vicini escono in ordine di distanza, col loro verso', () => {
    const layout = [
        { asset: 'albero', category: 'nature', x: 100, z: 0 },
        { asset: 'tribuna', category: 'grandstand', x: 10, z: 0 },
        { asset: 'roccia', category: 'nature', x: 0, z: -30 }
    ];
    // Auto nell'origine, muso verso +Z (0 gradi).
    const rec = { pos: { x: 0, y: 0, z: 0 }, headingDeg: 0 };
    const v = tool.vicini(layout, rec, 2);
    assert.equal(v.length, 2);
    assert.deepEqual(v.map(o => o.asset), ['tribuna', 'roccia']);
    assert.equal(v[0].distanza, 10);
    assert.equal(v[0].direzione, 'a destra');    // +X con muso a 0 è la destra del pilota
    assert.equal(v[1].direzione, 'dietro');      // -Z con muso a 0
});

test('chiedere più vicini di quanti ce ne sono non rompe niente', () => {
    const layout = [{ asset: 'albero', category: 'nature', x: 5, z: 0 }];
    const v = tool.vicini(layout, { pos: { x: 0, y: 0, z: 0 }, headingDeg: 0 }, 5);
    assert.equal(v.length, 1);
});
```

- [ ] **Step 2: Lancia il test e verifica che fallisca**

Run: `node --test backend/tools/f1-segnalazioni.test.js`
Expected: FAIL — `tool.vicini is not a function`

- [ ] **Step 3: Implementa `vicini` e la ricostruzione del layout**

In `backend/tools/f1-segnalazioni.js`, aggiungi i require in testa:

```js
const fs = require('fs');
const TrackScenery = require('../../frontend/shared/trackScenery.js');
```

Aggiungi la funzione pura, dopo `gradiVerso`:

```js
// I `quanti` oggetti di scenografia più vicini al punto, con distanza e
// verso rispetto al muso: serve a distinguere l'oggetto che il giocatore
// stava guardando da quello che aveva alle spalle.
function vicini(layout, rec, quanti) {
    return layout
        .map(v => ({
            asset: v.asset,
            category: v.category,
            distanza: Math.round(Math.hypot(v.x - rec.pos.x, v.z - rec.pos.z) * 100) / 100,
            direzione: direzioneRelativa(rec.headingDeg, gradiVerso(rec.pos, v))
        }))
        .sort((a, b) => a.distanza - b.distanza)
        .slice(0, quanti);
}
```

Aggiungi la ricostruzione del layout, che replica la chiamata del client a `frontend/f1.js:655`:

```js
// Ricostruisce lo STESSO layout che il gioco ha generato al caricamento.
// Ogni argomento qui sotto corrisponde a uno di f1.js:655 — se uno diverge,
// gli oggetti che stampiamo non sono quelli che il giocatore aveva davanti.
const CURB_W = 2.8;              // f1.js:156
const EMBANKMENT_WIDTH = 45;     // f1.js:168

function layoutDi(trackId, track) {
    // Il .json grezzo della pista, non l'oggetto derivato di loadTrack:
    // generateLayout vuole controlPoints, pit.path, pit.boxIndex.
    const raw = JSON.parse(fs.readFileSync(
        path.join(__dirname, '..', '..', 'frontend', 'tracks', `${trackId}.json`), 'utf8'));
    // I posti a sedere: il client li prende con una fetch (f1.js:646), qui si
    // leggono dal file. Se mancano, la scenografia si genera lo stesso senza
    // spettatori — che per noi non sono oggetti da segnalare.
    let seatAnchors = null;
    try {
        seatAnchors = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'frontend',
            'assets', 'custom', 'circuit', 'grandStandSeats.json'), 'utf8')).seats;
    } catch (err) { /* tribune vuote, come fa il client */ }

    const BARRIER_D = raw.roadHalfWidth + CURB_W + 1.2;   // f1.js:157
    // track.points e track.pitLanePts sono campionati con le stesse costanti
    // del client (1000 e 300 campioni, vedi trackLoader.js:14-17).
    return TrackScenery.generateLayout(raw, track.points, track.pitLanePts,
        BARRIER_D, EMBANKMENT_WIDTH, seatAnchors, track.barrierProfile);
}
```

Nella funzione `stampa`, dopo aver caricato la pista, calcola il layout e stampane il riepilogo per categoria; poi per ogni record stampa i vicini:

```js
        if (rec.trackId !== ultimoTrack) {
            track = loadTrack(rec.trackId);
            layout = layoutDi(rec.trackId, track);
            ultimoTrack = rec.trackId;
            console.log(`\n=== ${track.name} (${rec.trackId}) ===`);
            // Riepilogo per confrontare la ricostruzione col client: se questi
            // numeri non coincidono con quelli loggati dal gioco, i nomi degli
            // oggetti stampati sotto NON sono attendibili.
            const perCategoria = {};
            for (const v of layout) perCategoria[v.category] = (perCategoria[v.category] || 0) + 1;
            console.log(`    scenografia ricostruita: ${layout.length} elementi —`,
                Object.entries(perCategoria).map(([c, n]) => `${c}:${n}`).join(' '));
        }
```

e in fondo al blocco di ogni record:

```js
        for (const v of vicini(layout, rec, 5)) {
            console.log(`     · ${v.asset} (${v.category}) a ${v.distanza}, ${v.direzione}`);
        }
```

Dichiara `let layout = null;` accanto a `let ultimoTrack = null, track = null;` ed esporta la funzione nuova:

```js
module.exports = { descriviPuntoPista, direzioneRelativa, gradiVerso, vicini, layoutDi, stampa };
```

- [ ] **Step 4: Lancia il test e verifica che passi**

Run: `node --test backend/tools/f1-segnalazioni.test.js`
Expected: PASS, 8 test

- [ ] **Step 5: Verifica che il layout ricostruito sia quello del gioco**

Questo è lo step che smaschera l'errore silenzioso. Aggiungi **temporaneamente** in `frontend/f1.js`, subito dopo la riga 655:

```js
    console.log('[F1] scenografia:', sceneryLayout.length, sceneryLayout.reduce((acc, v) => { acc[v.category] = (acc[v.category] || 0) + 1; return acc; }, {}));
```

Bumpa il `?v=` di `f1.js` in `f1.html`, ricarica il gioco con hard refresh sullo stesso tracciato delle segnalazioni e leggi il log in console. Poi:

Run: `node backend/tools/f1-segnalazioni.js`

Expected: il totale e i conteggi per categoria stampati dal tool coincidono **esattamente** con quelli del browser.

- **Se coincidono:** togli il `console.log` temporaneo, ri-bumpa il `?v=`, prosegui.
- **Se NON coincidono:** non aggiustare a caso. Confronta un argomento per volta con `f1.js:655` (il candidato più probabile è `seatAnchors`, che cambia solo il numero di spettatori, oppure `barrierProfile`). Se non si chiude in fretta, applica il ripiego previsto dalla spec: togli la stampa dei vicini, lascia il tool alla sola geometria di pista del Task 5 e annota il perché in `docs/f1-notes.md`.

- [ ] **Step 6: Documenta l'uso in docs/f1-notes.md**

In fondo a `docs/f1-notes.md`, aggiungi:

```markdown
## Segnalazioni in gioco (tasto M) — 2026-08-12

Durante una gara in locale, `M` registra dove sei e dove stai guardando;
`Shift+M` annulla l'ultima. Il numero che compare a schermo è quello scritto
nel file, assegnato dal server.

- Le route stanno in `backend/dev/segnalazioniRoutes.js` e sono attive solo
  fuori produzione, come `/dev/minimap`.
- Il file è `backend/tools/f1-segnalazioni.json` (in `.gitignore`).
- Per rileggerle: `node backend/tools/f1-segnalazioni.js`. Stampa, per ogni
  punto, la posizione sul giro e i cinque elementi di scenografia più vicini
  con distanza e verso rispetto al muso.

**Attenzione alla riga "scenografia ricostruita" in testa a ogni tracciato:**
il tool rigenera il layout con `TrackScenery.generateLayout` replicando la
chiamata di `frontend/f1.js:655`. Se quei conteggi non coincidono con quelli
del gioco, i nomi degli oggetti stampati non valgono niente — la posizione sì.
```

- [ ] **Step 7: Commit**

```bash
git add backend/tools/f1-segnalazioni.js backend/tools/f1-segnalazioni.test.js docs/f1-notes.md
git commit -m "F1 segnalazioni: il tool dice quali oggetti avevi intorno"
```

---

## Verifica finale

- [ ] `node --test frontend/shared/f1Segnalazioni.test.js backend/dev/segnalazioniStore.test.js backend/dev/segnalazioniRoutes.test.js backend/tools/f1-segnalazioni.test.js` — tutti verdi.
- [ ] `node --test` sull'intero repo: i rossi devono restare **i 4 preesistenti** (Simcade isolamento componenti, i due `loadTrack("monte-rosso")`, `simulateLap` col preset di tuning), più l'intermittente `simulateLap: test-scratch-track`. Nessun rosso nuovo.
- [ ] Un giro di ricognizione dell'utente sul tracciato del difetto aperto, e la lista riletta insieme.
