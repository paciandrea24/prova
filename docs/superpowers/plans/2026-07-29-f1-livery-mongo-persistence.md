# F1 — 4b/A: persistenza livrea su MongoDB — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** salvare/leggere la livrea F1 dell'utente su MongoDB (collection
`liveries`, un documento per `uid` Firebase), verificando lato server chi
sta salvando tramite `firebase-admin`, così `carLoader.js` (già pronto da
B') potrà caricare `liveryColors` da un vero salvataggio invece che dalla
fixture statica `f1CarTestLivery.json`.

**Architecture:** tre moduli nuovi e indipendenti — `verifyFirebaseToken.js`
(middleware Express che verifica il token Firebase e attacca `req.uid`),
`liveryStore.js` (save/get su Mongo, nessuna cache RAM, stesso pattern
client-diretto di `leaderboard.js`), `routes/livery.js` (router con
`POST /api/livery` protetto e `GET /api/livery/:uid` pubblico). Montati in
`server.js` accanto a `lobbyRoutes` già esistente.

**Tech Stack:** Node.js, Express 5, driver `mongodb` (già presente),
nuova dipendenza `firebase-admin`, `node:test`/`node:assert/strict` solo
per la porzione testabile senza servizi esterni veri.

## Global Constraints

- **Italiano** in commenti/comunicazioni (da CLAUDE.md di progetto).
- **Niente commit automatici**: l'utente fa commit/push manualmente — i
  task di questo piano NON includono uno step di `git commit` (stessa
  convenzione già usata nei piani precedenti di questo progetto, es.
  `2026-07-28-f1-aerodynamics-fase4-scia.md`).
- Riferimento: `docs/superpowers/specs/2026-07-29-f1-livery-mongo-persistence-design.md`.
- **Env var, non file**: credenziali (`MONGODB_URI`, nuova
  `FIREBASE_SERVICE_ACCOUNT_JSON`) sempre da `process.env`, mai file
  committati — stessa convenzione già in uso in `leaderboard.js`.
- **`POST /api/livery` protetto, `GET /api/livery/:uid` pubblico** — la
  livrea è puramente estetica, la lettura non richiede identità.
- **Nessuna cache RAM** in `liveryStore.js` (a differenza di
  `leaderboard.js`) — query diretta a Mongo per richiesta, deciso in
  fase di design (letture rare, non un hot path).
- **Nessun test automatico** per il percorso che dipende da servizi
  esterni veri (verifica reale di un token Firebase, round-trip reale su
  Mongo) — deciso esplicitamente in fase di design, verifica manuale via
  `curl` descritta in ciascun task. Sono comunque testabili in automatico
  (e vanno testati) i rami che NON toccano un servizio esterno vero (es.
  "variabile d'ambiente mancante").
- **Non toccare**: `carLoader.js`, `f1.js`, `frontend/assets/custom/f1CarTestLivery.json`,
  l'editor esterno `voxel_livery_studio.html` — questo piano è solo
  backend.

---

### Task 1: Dipendenza `firebase-admin`

**Files:**
- Modify: `backend/package.json` (via `npm install`)

**Interfaces:**
- Produces: pacchetto `firebase-admin` disponibile per `require()` nei
  Task successivi.

- [ ] **Step 1: Installare la dipendenza**

Dalla cartella `backend/`:

```bash
npm install firebase-admin
```

- [ ] **Step 2: Verificare che sia stata aggiunta a `package.json`**

Apri `backend/package.json` e conferma che `dependencies` contenga una
riga `"firebase-admin": "^14.x.x"` (o versione maggiore installata).

- [ ] **Step 3: Verificare che il modulo si carichi senza errori**

```bash
node -e "require('firebase-admin'); console.log('OK: firebase-admin caricato')"
```

Expected output: `OK: firebase-admin caricato` (nessun errore/stacktrace).

---

### Task 2: `verifyFirebaseToken.js` — middleware di verifica token

**Files:**
- Create: `backend/auth/verifyFirebaseToken.js`

**Interfaces:**
- Consumes: `firebase-admin` (Task 1), env var `FIREBASE_SERVICE_ACCOUNT_JSON`.
- Produces: `verifyFirebaseToken(req, res, next)` — middleware Express;
  in caso di successo imposta `req.uid` (stringa) e chiama `next()`.
  Consumato da Task 4 (`routes/livery.js`).

- [ ] **Step 1: Creare il modulo**

```js
// backend/auth/verifyFirebaseToken.js
//
// Verifica il token ID Firebase mandato dal client (header
// "Authorization: Bearer <idToken>") ed estrae l'uid, per proteggere le
// rotte che scrivono dati legati a un utente specifico (es. salvataggio
// livrea F1). Non salva/legge nulla: l'identità è tutto ciò che fa.
const admin = require('firebase-admin');

let initialized = false;

if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
        admin.initializeApp({
            credential: admin.credential.cert(
                JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
            )
        });
        initialized = true;
    } catch (error) {
        console.error('❌ Errore inizializzazione Firebase Admin:', error.message);
    }
} else {
    console.warn('⚠️ FIREBASE_SERVICE_ACCOUNT_JSON mancante! Le rotte protette da verifyFirebaseToken risponderanno sempre 503.');
}

async function verifyFirebaseToken(req, res, next) {
    if (!initialized) {
        return res.status(503).json({ error: 'Servizio di autenticazione non configurato' });
    }

    const header = req.headers.authorization || '';
    const match = header.match(/^Bearer (.+)$/);
    if (!match) {
        return res.status(401).json({ error: 'Token mancante' });
    }

    try {
        const decoded = await admin.auth().verifyIdToken(match[1]);
        req.uid = decoded.uid;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Token non valido' });
    }
}

module.exports = { verifyFirebaseToken };
```

- [ ] **Step 2: Verifica manuale — senza `FIREBASE_SERVICE_ACCOUNT_JSON`, il modulo non crasha**

```bash
node -e "
delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
const { verifyFirebaseToken } = require('./auth/verifyFirebaseToken');
const res = {
    status(code) { this.code = code; return this; },
    json(body) { console.log('status:', this.code, 'body:', JSON.stringify(body)); }
};
verifyFirebaseToken({ headers: {} }, res, () => console.log('next() chiamato (non atteso)'));
"
```

Expected output: warning `FIREBASE_SERVICE_ACCOUNT_JSON mancante...` su
stderr, poi `status: 503 body: {"error":"Servizio di autenticazione non configurato"}`
su stdout — nessun crash, `next()` MAI chiamato.

- [ ] **Step 3: Verifica manuale — con env var presente ma header mancante, 401**

Serve un service account (anche di test, purché con la forma corretta:
`project_id`, `client_email`, `private_key`) per superare
`admin.initializeApp`. Se hai già scaricato il service account reale dal
progetto Firebase di 4a, usalo:

```bash
export FIREBASE_SERVICE_ACCOUNT_JSON="$(cat /percorso/al/service-account.json)"
node -e "
const { verifyFirebaseToken } = require('./auth/verifyFirebaseToken');
const res = {
    status(code) { this.code = code; return this; },
    json(body) { console.log('status:', this.code, 'body:', JSON.stringify(body)); }
};
verifyFirebaseToken({ headers: {} }, res, () => console.log('next() chiamato (non atteso)'));
"
```

Expected output: `status: 401 body: {"error":"Token mancante"}`.

Questo è l'ultimo step automatizzabile senza un vero token: la verifica
di un token VALIDO/NON VALIDO reale avviene end-to-end nel Task 4
(dipende da Mongo + un utente reale creato in 4a, non isolabile qui).

---

### Task 3: `liveryStore.js` — save/get su MongoDB

**Files:**
- Create: `backend/store/liveryStore.js`
- Test: `backend/store/liveryStore.test.js`

**Interfaces:**
- Consumes: `mongodb` (già dipendenza esistente), env var `MONGODB_URI`.
- Produces: `saveLivery(uid, { liveryColors, liveryParams }) -> Promise<doc>`,
  `getLivery(uid) -> Promise<doc|null>`. Consumati da Task 4
  (`routes/livery.js`).

- [ ] **Step 1: Scrivere il test che copre il ramo senza servizio esterno**

```js
// backend/store/liveryStore.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

test('saveLivery: senza MONGODB_URI -> rifiuta con errore esplicito, nessuna scrittura tentata', async () => {
    delete process.env.MONGODB_URI;
    delete require.cache[require.resolve('./liveryStore')];
    const { saveLivery } = require('./liveryStore');

    await assert.rejects(
        () => saveLivery('uid-test', { liveryColors: { Chassis: [1, 0, 0] }, liveryParams: null }),
        /MONGODB_URI/
    );
});

test('getLivery: senza MONGODB_URI -> risolve null (nessun crash)', async () => {
    delete process.env.MONGODB_URI;
    delete require.cache[require.resolve('./liveryStore')];
    const { getLivery } = require('./liveryStore');

    const result = await getLivery('uid-test');
    assert.equal(result, null);
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

```bash
node --test backend/store/liveryStore.test.js
```

Expected: FAIL — `./liveryStore` non esiste ancora.

- [ ] **Step 3: Implementazione minima**

```js
// backend/store/liveryStore.js
//
// Salvataggio/lettura della livrea F1 per utente su MongoDB (collection
// "liveries", un documento per uid Firebase). A differenza di
// leaderboard.js NON tiene una cache RAM: le letture sono rare (solo
// quando un'auto con quella livrea entra in scena), non un hot path —
// query diretta a Mongo per richiesta.
const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;

let collectionPromise = null;

function getCollection() {
    if (!MONGODB_URI) return null;
    if (!collectionPromise) {
        collectionPromise = MongoClient.connect(MONGODB_URI)
            .then(client => client.db('RacingGameDB').collection('liveries'));
    }
    return collectionPromise;
}

async function saveLivery(uid, { liveryColors, liveryParams }) {
    const collectionP = getCollection();
    if (!collectionP) {
        throw new Error('MONGODB_URI mancante: impossibile salvare la livrea');
    }
    const collection = await collectionP;
    const doc = {
        liveryColors,
        liveryParams: liveryParams || null,
        updatedAt: new Date().toISOString()
    };
    await collection.updateOne({ _id: uid }, { $set: doc }, { upsert: true });
    return { _id: uid, ...doc };
}

async function getLivery(uid) {
    const collectionP = getCollection();
    if (!collectionP) return null;
    const collection = await collectionP;
    return collection.findOne({ _id: uid });
}

module.exports = { saveLivery, getLivery };
```

- [ ] **Step 4: Eseguire i test e verificare che passino**

```bash
node --test backend/store/liveryStore.test.js
```

Expected: PASS su entrambi i test.

- [ ] **Step 5: Verifica manuale — round-trip reale su Mongo**

Con `MONGODB_URI` puntato a un cluster reale (lo stesso già in uso per
la leaderboard va bene, è lo stesso database `RacingGameDB`):

```bash
export MONGODB_URI="<stringa di connessione reale>"
node -e "
const { saveLivery, getLivery } = require('./store/liveryStore');
(async () => {
    const saved = await saveLivery('uid-manual-test', {
        liveryColors: { Chassis: [0.8, 0.1, 0.1] },
        liveryParams: { pattern: 'racing_stripes' }
    });
    console.log('salvato:', JSON.stringify(saved));
    const loaded = await getLivery('uid-manual-test');
    console.log('letto:', JSON.stringify(loaded));
})();
"
```

Expected: `salvato` e `letto` riportano lo stesso `liveryColors`/
`liveryParams` (a meno di `updatedAt`, sempre presente in entrambi).

---

### Task 4: `routes/livery.js` — endpoint HTTP + montaggio in `server.js`

**Files:**
- Create: `backend/routes/livery.js`
- Modify: `backend/server.js`

**Interfaces:**
- Consumes: `verifyFirebaseToken` (Task 2), `saveLivery`/`getLivery`
  (Task 3).
- Produces: `POST /api/livery`, `GET /api/livery/:uid` montate
  sull'app Express.

- [ ] **Step 1: Creare il router**

```js
// backend/routes/livery.js
const express = require('express');
const router = express.Router();
const { verifyFirebaseToken } = require('../auth/verifyFirebaseToken');
const { saveLivery, getLivery } = require('../store/liveryStore');

// POST /api/livery — protetta: salva SOLO la livrea dell'uid verificato
// dal token, mai un uid letto dal body (evita che un utente salvi la
// livrea di un altro).
router.post('/api/livery', verifyFirebaseToken, async (req, res) => {
    const { liveryColors, liveryParams } = req.body || {};
    if (!liveryColors || typeof liveryColors !== 'object') {
        return res.status(400).json({ error: 'liveryColors mancante o non valido' });
    }
    try {
        const doc = await saveLivery(req.uid, { liveryColors, liveryParams });
        res.status(200).json(doc);
    } catch (error) {
        console.error('❌ Errore salvataggio livrea:', error.message);
        res.status(500).json({ error: 'Errore salvataggio livrea' });
    }
});

// GET /api/livery/:uid — pubblica: la livrea è estetica, visibile a
// chiunque guardi l'auto in pista, nessun token richiesto in lettura.
router.get('/api/livery/:uid', async (req, res) => {
    try {
        const doc = await getLivery(req.params.uid);
        if (!doc) return res.status(404).json({ error: 'Livrea non trovata' });
        res.json(doc);
    } catch (error) {
        console.error('❌ Errore lettura livrea:', error.message);
        res.status(500).json({ error: 'Errore lettura livrea' });
    }
});

module.exports = router;
```

- [ ] **Step 2: Montare il router in `server.js`**

In `backend/server.js`, vicino a `const lobbyRoutes = require('./routes/lobbyRoutes');`:

```js
const liveryRoutes = require('./routes/livery');
```

E vicino a `app.use('/', lobbyRoutes);`:

```js
app.use('/', liveryRoutes);
```

- [ ] **Step 3: Avviare il server in locale**

```bash
node server.js
```

(dalla cartella `backend/`, con `MONGODB_URI` e
`FIREBASE_SERVICE_ACCOUNT_JSON` impostate nell'ambiente o in `.env`)

Expected: `✅ Server listening on port 3000`, nessun errore di
inizializzazione Firebase/Mongo in console.

- [ ] **Step 4: Ottenere un ID token reale di test**

Con un utente email+password già creato in 4a (via `register.html` in
locale) e l'API key web del progetto Firebase (visibile in Firebase
Console → Project Settings → General):

```bash
curl -X POST "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=<API_KEY_WEB>" \
  -H "Content-Type: application/json" \
  -d '{"email":"<email di test>","password":"<password di test>","returnSecureToken":true}'
```

Expected: risposta JSON con un campo `idToken` (stringa lunga) e
`localId` (l'uid Firebase dell'utente) — salvarli per gli step
successivi.

- [ ] **Step 5: Verificare `POST /api/livery` con token valido**

Da eseguire dalla **root del repo** (non da `backend/` come gli altri
comandi di questo piano): il comando `node -e` sotto costruisce il body
leggendo `frontend/assets/custom/f1CarTestLivery.json` con un path
relativo alla root, e il file va comunque wrappato in
`{"liveryColors": ..., "liveryParams": ...}` — l'endpoint si aspetta
quella busta, non la mappa colori nuda (chiavi top-level tipo
`Chassis`/`Nose`/`Plank`), che darebbe sempre 400 "liveryColors
mancante":

```bash
curl -i -X POST http://localhost:3000/api/livery \
  -H "Authorization: Bearer <idToken dello Step 4>" \
  -H "Content-Type: application/json" \
  -d "$(node -e "console.log(JSON.stringify({liveryColors: require('./frontend/assets/custom/f1CarTestLivery.json'), liveryParams: null}))")"
```

Expected: `HTTP/1.1 200 OK`, corpo JSON con `_id` uguale al `localId`
dello Step 4 e lo stesso `liveryColors` della fixture in input.

- [ ] **Step 6: Verificare `GET /api/livery/:uid` per lo stesso uid**

```bash
curl -i http://localhost:3000/api/livery/<localId dello Step 4>
```

Expected: `HTTP/1.1 200 OK`, `liveryColors` identico byte-per-byte a
`frontend/assets/custom/f1CarTestLivery.json`.

- [ ] **Step 7: Verificare il rifiuto senza token**

```bash
curl -i -X POST http://localhost:3000/api/livery \
  -H "Content-Type: application/json" \
  -d '{"liveryColors":{"Chassis":[1,0,0]}}'
```

Expected: `HTTP/1.1 401 Unauthorized`, `{"error":"Token mancante"}`.

- [ ] **Step 8: Verificare 404 su uid inesistente**

```bash
curl -i http://localhost:3000/api/livery/uid-che-non-esiste-mai
```

Expected: `HTTP/1.1 404 Not Found`, `{"error":"Livrea non trovata"}`.

- [ ] **Step 9: Verifica di confine (nessun altro file toccato)**

```bash
git diff --stat frontend/ backend/sockets/ backend/store/leaderboard.js backend/store/lobbies.js
```

Expected: nessun output (questo piano tocca solo i 4 file nuovi/
modificati elencati nei Task 1-4).

---

## Esito atteso di questo piano

Un utente autenticato (sessione Firebase da 4a) può salvare la propria
livrea F1 (`liveryColors` + `liveryParams`) su MongoDB tramite
`POST /api/livery` (token verificato server-side, nessun altro uid
falsificabile), e chiunque può leggerla con `GET /api/livery/:uid` (dato
puramente estetico, nessun token in lettura). Nessun collegamento ancora
con la UI di gioco (D, editor con pulsante "Salva") né con la rete
multiplayer (C, come gli altri client scoprono quale uid ha quale
livrea) — entrambi restano sotto-progetti separati futuri.
