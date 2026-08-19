# F1 Stagioni — passo 2b: creare e ritrovare una stagione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dalla lobby si sceglie *Stagione*, si atterra in `f1.html`, si crea un campionato (nome, quante gare, quanti piloti) o si riprende uno dei propri, e si vede il calendario con la classifica. Non si corre ancora: *CORRI* arriva al passo 3.

**Architecture:** Le stagioni si leggono e si scrivono via **HTTP protetto da `verifyFirebaseToken`** — stesso identico pattern di `backend/routes/livery.js` — così l'uid che finisce dentro un documento è quello verificato dal token, mai quello dichiarato dal client. Il **socket** non decide mai chi sei: serve solo a dire a tutti i presenti quale stagione l'host ha scelto. Lato partita, il formato `stagione` fa nascere la sessione F1 in una fase nuova `'stagione'` che **precede** `tyre_select`: il codice del weekend non viene toccato, gli si mette davanti una schermata.

**Tech Stack:** Node.js + Express (rotte), Socket.io (sincronizzazione), MongoDB via `backend/store/seasonStore.js`, regole pure in `frontend/shared/f1Stagione.js` (UMD, gira anche lato server), HTML/CSS/JS vanilla lato client, `node:test` per i test.

**Spec:** `docs/superpowers/specs/2026-08-19-f1-stagioni-design.md`

## Global Constraints

- **Il codice del weekend non si tocca.** Se per far funzionare le stagioni servisse mettere le mani dentro qualifica o gara, la strada è sbagliata (spec, «Il punto»). La fase `'stagione'` sta *prima* di `tyre_select` e non ne cambia il comportamento.
- **La classifica non si salva, si calcola.** Nel documento ci sono solo i risultati delle gare corse. Vedi `feedback_una_cosa_una_misura`.
- **Account obbligatorio.** Senza uid verificato non si crea e non si riprende niente.
- **Le piste non si ripetono** dentro una stagione, e il numero di gare si sceglie fra `MIN_GARE` (3) e il numero di piste disponibili — mai legato al totale delle piste del gioco.
- **Punteggio**: `F1Stagione.PUNTI` = 25, 18, 15, 12, 10, 8, 6, 4, 2, 1. Costante in un punto solo, già scritta.
- **Italiano** in tutta la UI di gioco e nei commenti (la lobby resta in inglese: è hub di piattaforma — vedi `feedback_platform_hub_english_games_italian`).
- **Niente emoji nell'UI** (`feedback_no_emoji`): glyph unicode monocromatici o SVG.
- **Cache-busting**: ogni modifica a `frontend/f1.js` o a uno script `shared/` richiede il bump del `?v=` in `frontend/f1.html` (`feedback_f1_cachebusting_version_bump`).
- **Commit ad ogni task** (`feedback_commit_ad_ogni_task`). Mai `git add -A`: aggiungere per nome, l'utente lavora in parallelo sulle piste (`feedback_niente_git_add_a_tappeto`). **Il push lo fa l'utente**, mai l'agente.
- **Ripiego in memoria**: senza `MONGODB_URI` `seasonStore` tiene tutto in una Map e le stagioni muoiono al riavvio del server. È voluto e documentato: in locale il `.env` ha Firebase ma non Mongo, quindi le rotte protette funzionano e la persistenza no. Non «aggiustarlo».

---

## Struttura dei file

| File | Responsabilità |
|---|---|
| `backend/routes/f1Stagioni.js` *(nuovo)* | Le tre rotte HTTP: elenco delle mie, creazione, lettura singola. Unico punto in cui un uid verificato entra in un documento. |
| `backend/routes/f1Stagioni.test.js` *(nuovo)* | Contratto delle rotte: chi può cosa, e cosa finisce dentro il documento. |
| `backend/server.js` | Montaggio della rotta nuova (2 righe). |
| `backend/sockets/games/f1GameSocket.js` | Fase `'stagione'`, evento `f1StagioneScelta`, e il gate che impedisce a `startTyreSelect` di partire in formato stagione. |
| `backend/sockets/games/f1GameSocket.stagione.test.js` *(nuovo)* | Che in formato stagione il weekend NON parta da solo, e che la scelta dell'host arrivi a tutti. |
| `frontend/lobby.js`, `frontend/lobby.html` | *Season* avvia la sessione con `formato: 'stagione'` invece di mostrare «coming soon». |
| `frontend/shared/f1StagioneSchermate.js` *(nuovo)* | Tutte le schermate della stagione: scelta, creazione, calendario+classifica. Non tocca la scena 3D, non conosce la fisica — riceve socket, lobbyId e un modo per prendere il token. |
| `frontend/f1.html` | Markup delle schermate + `<script>` + bump `?v=`. |
| `frontend/f1.js` | Un solo aggancio: se `f1Setup.phase === 'stagione'`, monta le schermate. |
| `frontend/styles/f1.css` | Stile delle schermate, nello stesso linguaggio della schermata mescole. |

---

### Task 1: Le rotte delle stagioni

**Files:**
- Create: `backend/routes/f1Stagioni.js`
- Create: `backend/routes/f1Stagioni.test.js`
- Modify: `backend/server.js` (accanto a `app.use('/', liveryRoutes);`)

**Interfaces:**
- Consumes: `seasonStore.{salva, leggi, elencoPerUid}`, `F1Stagione.{creaStagione, sorteggiaCalendario, intervalloGare, siPuoRiprendere, classifica}`, `pickBotColors` da `f1Bot.js`, `listTracks` da `trackLoader.js`, `activeGames` da `store/activeGames.js`.
- Produces:
  - `GET  /api/f1/stagioni` → `{ stagioni: [{ _id, nome, calendario, giro, piloti, aggiornataIl }] }`
  - `POST /api/f1/stagioni` body `{ lobbyId, nome, quanteGare, gridSize, botsEnabled }` → `{ stagione }` (201) — i **piloti li legge il server** dalla partita attiva, non il client
  - `GET  /api/f1/stagioni/:id` → `{ stagione }` — solo se `req.uid` è fra i suoi piloti
  - export `router` (default) e `{ costruisciPiloti }` per i test

- [ ] **Step 1: Scrivere il test che fallisce**

Crea `backend/routes/f1Stagioni.test.js`. Il middleware vero chiama Firebase, che in un test non c'è: la rotta accetta quindi un middleware iniettabile, e il test ne passa uno finto che scrive `req.uid`. Questo è il motivo per cui il modulo esporta una `factory`, non solo un router già montato.

```js
// backend/routes/f1Stagioni.test.js
//
// Le stagioni sono l'unica cosa del gioco legata a un ACCOUNT, e questo file
// protegge la sola regola che conta: dentro un documento ci finisce l'uid
// VERIFICATO dal token, mai quello che il client dichiara. Il resto (elenco,
// lettura) discende da li'.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');

const { creaRouter } = require('./f1Stagioni.js');
const seasonStore = require('../store/seasonStore.js');
const { activeGames } = require('../store/activeGames.js');

const LOBBY = 'TESTSTAG';

// Il finto verificatore di token: legge l'uid da un header di comodo. Sta al
// posto di verifyFirebaseToken, che in un test non puo' girare.
function autenticaFinto(req, res, next) {
    const uid = req.headers['x-test-uid'];
    if (!uid) return res.status(401).json({ error: 'Token mancante' });
    req.uid = uid;
    next();
}

function avviaServer() {
    const app = express();
    app.use(express.json());
    app.use('/', creaRouter({ autentica: autenticaFinto }));
    const server = http.createServer(app);
    return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

function chiedi(server, { metodo = 'GET', percorso, uid, corpo }) {
    const { port } = server.address();
    const dati = corpo ? JSON.stringify(corpo) : null;
    const intestazioni = {};
    if (uid) intestazioni['x-test-uid'] = uid;
    if (dati) { intestazioni['Content-Type'] = 'application/json'; intestazioni['Content-Length'] = Buffer.byteLength(dati); }
    return new Promise((risolvi, rifiuta) => {
        const req = http.request({ host: '127.0.0.1', port, path: percorso, method: metodo, headers: intestazioni }, (res) => {
            let c = '';
            res.on('data', (p) => { c += p; });
            res.on('end', () => {
                let d = null;
                try { d = JSON.parse(c); } catch (e) { /* non JSON */ }
                risolvi({ stato: res.statusCode, dati: d });
            });
        });
        req.on('error', rifiuta);
        if (dati) req.write(dati);
        req.end();
    });
}

// Una partita F1 finta: alla rotta servono solo i piloti e il loro uid.
function preparaPartita(giocatori) {
    const players = {};
    for (const g of giocatori) players[g.colore] = { color: g.colore, uid: g.uid || null, isBot: !!g.bot };
    activeGames.set(LOBBY, { gameId: 'f1', players, gridSize: 6, settings: {} });
}

function pulisci() {
    activeGames.delete(LOBBY);
    seasonStore._svuota();
}

test('creare una stagione: chi la crea e i suoi compagni li dice la PARTITA, non il client', async (t) => {
    t.after(pulisci);
    const server = await avviaServer();
    t.after(() => server.close());
    preparaPartita([{ colore: '#e74c3c', uid: 'uid-andrea' }, { colore: '#3498db', uid: 'uid-amico' }]);

    const r = await chiedi(server, {
        metodo: 'POST', percorso: '/api/f1/stagioni', uid: 'uid-andrea',
        // L'intruso: il client prova a dichiarare i piloti di suo pugno.
        corpo: { lobbyId: LOBBY, nome: 'Mondiale', quanteGare: 3, gridSize: 4, piloti: [{ uid: 'uid-estraneo' }] },
    });

    assert.equal(r.stato, 201);
    const s = r.dati.stagione;
    assert.equal(s.creataDa, 'uid-andrea', 'chi crea e\' l\'uid del TOKEN');
    const umani = s.piloti.filter(p => !p.bot).map(p => p.uid).sort();
    assert.deepEqual(umani, ['uid-amico', 'uid-andrea'],
        'i piloti umani sono quelli della partita; quelli dichiarati dal client si ignorano');
    assert.equal(s.piloti.length, 4, 'la griglia si riempie di bot fino a gridSize');
    assert.ok(s.piloti.filter(p => p.bot).every(p => p.colore && p.nome), 'ogni bot ha colore e nome stabili');
});

test('il calendario ha N piste distinte e la stagione parte dal giro 0', async (t) => {
    t.after(pulisci);
    const server = await avviaServer();
    t.after(() => server.close());
    preparaPartita([{ colore: '#e74c3c', uid: 'uid-andrea' }]);

    const r = await chiedi(server, {
        metodo: 'POST', percorso: '/api/f1/stagioni', uid: 'uid-andrea',
        corpo: { lobbyId: LOBBY, nome: 'Solitario', quanteGare: 3, gridSize: 6 },
    });

    const s = r.dati.stagione;
    assert.equal(s.calendario.length, 3);
    assert.equal(new Set(s.calendario).size, 3, 'una pista non si ripete');
    assert.equal(s.giro, 0);
    assert.deepEqual(s.risultati, []);
});

test('senza token non si crea niente', async (t) => {
    t.after(pulisci);
    const server = await avviaServer();
    t.after(() => server.close());
    preparaPartita([{ colore: '#e74c3c', uid: 'uid-andrea' }]);

    const r = await chiedi(server, {
        metodo: 'POST', percorso: '/api/f1/stagioni',
        corpo: { lobbyId: LOBBY, nome: 'Abusiva', quanteGare: 3, gridSize: 6 },
    });
    assert.equal(r.stato, 401);
});

test('l\'elenco porta le stagioni in cui CORRO, non solo quelle che ho creato', async (t) => {
    t.after(pulisci);
    const server = await avviaServer();
    t.after(() => server.close());
    preparaPartita([{ colore: '#e74c3c', uid: 'uid-andrea' }, { colore: '#3498db', uid: 'uid-amico' }]);
    await chiedi(server, {
        metodo: 'POST', percorso: '/api/f1/stagioni', uid: 'uid-andrea',
        corpo: { lobbyId: LOBBY, nome: 'Nostra', quanteGare: 3, gridSize: 4 },
    });

    const mie = await chiedi(server, { percorso: '/api/f1/stagioni', uid: 'uid-amico' });
    assert.equal(mie.stato, 200);
    assert.equal(mie.dati.stagioni.length, 1, 'l\'amico non l\'ha creata ma ci corre');
    assert.equal(mie.dati.stagioni[0].nome, 'Nostra');

    const estraneo = await chiedi(server, { percorso: '/api/f1/stagioni', uid: 'uid-estraneo' });
    assert.deepEqual(estraneo.dati.stagioni, [], 'chi non ci corre non la vede');
});

test('una stagione si legge solo se ci corri dentro', async (t) => {
    t.after(pulisci);
    const server = await avviaServer();
    t.after(() => server.close());
    preparaPartita([{ colore: '#e74c3c', uid: 'uid-andrea' }]);
    const creata = await chiedi(server, {
        metodo: 'POST', percorso: '/api/f1/stagioni', uid: 'uid-andrea',
        corpo: { lobbyId: LOBBY, nome: 'Mia', quanteGare: 3, gridSize: 6 },
    });
    const id = creata.dati.stagione._id;

    assert.equal((await chiedi(server, { percorso: '/api/f1/stagioni/' + id, uid: 'uid-andrea' })).stato, 200);
    assert.equal((await chiedi(server, { percorso: '/api/f1/stagioni/' + id, uid: 'uid-estraneo' })).stato, 404);
});

test('quante gare: sotto il minimo o sopra le piste disponibili e\' un rifiuto, non un silenzioso aggiustamento', async (t) => {
    t.after(pulisci);
    const server = await avviaServer();
    t.after(() => server.close());
    preparaPartita([{ colore: '#e74c3c', uid: 'uid-andrea' }]);

    const troppoPoche = await chiedi(server, {
        metodo: 'POST', percorso: '/api/f1/stagioni', uid: 'uid-andrea',
        corpo: { lobbyId: LOBBY, nome: 'Corta', quanteGare: 1, gridSize: 6 },
    });
    assert.equal(troppoPoche.stato, 400);
    assert.match(String(troppoPoche.dati.error), /gare/i);
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `node --test backend/routes/f1Stagioni.test.js`
Expected: FAIL — `Cannot find module './f1Stagioni.js'`

- [ ] **Step 3: Scrivere la rotta**

Crea `backend/routes/f1Stagioni.js`:

```js
// backend/routes/f1Stagioni.js
//
// Le stagioni salvate: elenco, creazione, lettura. Sono l'unica cosa del gioco
// legata a un ACCOUNT, quindi passano di qui e non dal socket.
//
// PERCHE' HTTP E NON SOCKET. Il socket sa il colore e un gettone di lobby, non
// l'account: l'uid che `joinF1Game` porta con se' e' DICHIARATO dal client e
// nessuno lo verifica — va benissimo per chiedere una livrea (e' estetica),
// non per decidere di chi e' un salvataggio. Qui l'uid arriva dal token
// Firebase verificato, esattamente come in routes/livery.js.
//
// PERCHE' I PILOTI LI DICE LA PARTITA. Se la lista arrivasse dal client, uno
// potrebbe infilare l'uid di un estraneo fra i piloti e fargli comparire nella
// lista una stagione che non ha mai giocato. La fonte e' `activeGames`: chi e'
// davvero connesso a quella partita in questo momento.
const express = require('express');
const { verifyFirebaseToken } = require('../auth/verifyFirebaseToken');
const seasonStore = require('../store/seasonStore');
const { activeGames } = require('../store/activeGames');
const { listTracks } = require('../sockets/games/trackLoader');
const { pickBotColors, MAX_GRID_SIZE } = require('../sockets/games/f1Bot');
const F1Stagione = require('../../frontend/shared/f1Stagione.js');

const NOME_MAX = 40;

// I piloti della stagione: gli umani connessi a quella partita, piu' i bot che
// servono a riempire la griglia. Fissati QUI una volta sola e mai piu'
// toccati: e' quello che rende confrontabili le classifiche fra un weekend e
// l'altro (spec, «Il modello dei dati»).
//
// I bot hanno colore e nome stabili per tutta la stagione. Oggi i bot nascono
// ad ogni partita con colori sorteggiati; dal passo 3 sara' la stagione a
// dettarli.
function costruisciPiloti(game, gridSize, botsEnabled) {
    const umani = Object.values(game.players)
        .filter(p => !p.isBot)
        .map(p => ({ uid: p.uid || null, colore: p.color, bot: false }));
    const posti = Math.min(MAX_GRID_SIZE, Math.max(umani.length, gridSize));
    const quantiBot = botsEnabled === false ? 0 : posti - umani.length;
    const coloriBot = pickBotColors(umani.map(u => u.colore), quantiBot);
    const bot = coloriBot.map((colore, i) => ({ uid: null, colore, bot: true, nome: `Bot ${i + 1}` }));
    return umani.concat(bot);
}

function creaRouter(opzioni) {
    const autentica = (opzioni && opzioni.autentica) || verifyFirebaseToken;
    const router = express.Router();

    // Le stagioni in cui corro. Non serve la partita: e' roba dell'account.
    router.get('/api/f1/stagioni', autentica, async (req, res) => {
        try {
            const stagioni = await seasonStore.elencoPerUid(req.uid);
            res.json({ stagioni });
        } catch (err) {
            console.error('GET /api/f1/stagioni:', err);
            res.status(500).json({ error: 'Impossibile leggere le stagioni' });
        }
    });

    router.post('/api/f1/stagioni', autentica, express.json(), async (req, res) => {
        const { lobbyId, nome, quanteGare, gridSize, botsEnabled } = req.body || {};
        const game = activeGames.get(lobbyId);
        if (!game || game.gameId !== 'f1') {
            return res.status(400).json({ error: 'Nessuna partita F1 attiva in questa lobby' });
        }
        // Chi crea dev'essere in pista: altrimenti si potrebbe creare una
        // stagione dentro la partita di qualcun altro.
        const presenti = Object.values(game.players).filter(p => !p.isBot).map(p => p.uid);
        if (!presenti.includes(req.uid)) {
            return res.status(403).json({ error: 'Non stai giocando in questa lobby' });
        }

        const piste = listTracks().map(t => t.id);
        const { min, max } = F1Stagione.intervalloGare(piste.length);
        const n = Number(quanteGare);
        if (!Number.isFinite(n) || n < min || n > max) {
            return res.status(400).json({ error: `Le gare devono essere fra ${min} e ${max}` });
        }

        const piloti = costruisciPiloti(game, Number(gridSize) || 6, botsEnabled !== false);
        const stagione = F1Stagione.creaStagione({
            nome: String(nome || '').slice(0, NOME_MAX),
            creataDa: req.uid,
            piloti,
            calendario: F1Stagione.sorteggiaCalendario(piste, n),
            impostazioni: { botsEnabled: botsEnabled !== false, gridSize: piloti.length },
        });

        try {
            const salvata = await seasonStore.salva(stagione);
            res.status(201).json({ stagione: salvata });
        } catch (err) {
            console.error('POST /api/f1/stagioni:', err);
            res.status(500).json({ error: 'Impossibile salvare la stagione' });
        }
    });

    // 404 e non 403 per chi non ci corre: che una stagione ESISTA con quell'id
    // e' gia' un'informazione, e non ha ragione di uscire.
    router.get('/api/f1/stagioni/:id', autentica, async (req, res) => {
        try {
            const stagione = await seasonStore.leggi(req.params.id);
            if (!stagione) return res.status(404).json({ error: 'Stagione non trovata' });
            const ciCorro = (stagione.piloti || []).some(p => p.uid === req.uid);
            if (!ciCorro) return res.status(404).json({ error: 'Stagione non trovata' });
            res.json({ stagione });
        } catch (err) {
            console.error('GET /api/f1/stagioni/:id:', err);
            res.status(500).json({ error: 'Impossibile leggere la stagione' });
        }
    });

    return router;
}

module.exports = { creaRouter, costruisciPiloti };
```

- [ ] **Step 4: Eseguire il test e verificare che passi**

Run: `node --test backend/routes/f1Stagioni.test.js`
Expected: PASS, 6/6.

- [ ] **Step 5: Montare la rotta nel server**

In `backend/server.js`, accanto agli altri require:

```js
const { creaRouter: creaRotteStagioni } = require('./routes/f1Stagioni');
```

e accanto a `app.use('/', liveryRoutes);`:

```js
app.use('/', creaRotteStagioni());
```

- [ ] **Step 6: Verificare che il server si avvii**

Run: `node -e "require('./backend/server.js')" ` — poi interrompere con Ctrl+C, oppure semplicemente `node --check backend/server.js` e avviare `node server.js` dalla cartella `backend/` per una prova manuale.
Expected: nessun errore di require; l'avviso `⚠️ [stagioni] MONGODB_URI mancante` è atteso in locale.

- [ ] **Step 7: Commit**

```bash
git add backend/routes/f1Stagioni.js backend/routes/f1Stagioni.test.js backend/server.js
git commit -m "Stagioni passo 2b/1: le rotte, con l'uid preso dal token e i piloti dalla partita"
```

---

### Task 2: La partita in formato stagione non parte da sola

**Files:**
- Modify: `backend/sockets/games/f1GameSocket.js` (creazione della partita ~riga 385, blocco `if (!game.tick)` ~riga 555)
- Create: `backend/sockets/games/f1GameSocket.stagione.test.js`

**Interfaces:**
- Consumes: `lobby.gameSettings.formato` (scritto da `startGame`, vedi Task 3).
- Produces:
  - `game.formato` — `'stagione'` o `'veloce'`
  - fase `'stagione'` nel ciclo di vita, che precede `tyre_select`
  - evento socket in ingresso `f1StagioneScelta { lobbyId, stagioneId }` (solo l'host)
  - evento socket in uscita `f1StagioneScelta { stagioneId }` a tutta la lobby
  - `f1Setup.formato` e `f1Setup.stagioneId`, letti dal client

- [ ] **Step 1: Scrivere il test che fallisce**

Crea `backend/sockets/games/f1GameSocket.stagione.test.js`:

```js
// backend/sockets/games/f1GameSocket.stagione.test.js
//
// In formato stagione il weekend NON deve partire da solo: prima si sceglie
// (o si crea) il campionato, e solo dopo si va alla scelta mescole. Il rischio
// vero e' che la fase di scelta mescole parta comunque e la sua scadenza porti
// tutti in qualifica mentre l'host sta ancora scrivendo il nome del campionato.
const test = require('node:test');
const assert = require('node:assert/strict');
const { lobbies, creaGettone } = require('../../store/lobbies.js');
const { activeGames } = require('../../store/activeGames.js');
const registraHandlerF1 = require('./f1GameSocket.js');

const LOBBY = 'TESTFORMATO';

function ioFinto() {
    const inviati = [];
    return { inviati, to: (dest) => ({ emit: (evento, dati) => inviati.push({ dest, evento, dati }) }) };
}

function collega(io) {
    const handlers = {};
    const socket = {
        id: 'sock-' + Math.random().toString(36).slice(2),
        data: {}, emessi: [], handlers,
        on(e, cb) { handlers[e] = cb; },
        emit(e, d) { this.emessi.push({ evento: e, dati: d }); },
        join() { },
    };
    registraHandlerF1(io, socket);
    return socket;
}

function pulisci() {
    const g = activeGames.get(LOBBY);
    if (g) {
        if (g.tick) clearInterval(g.tick);
        ['tyreSelectTimeout', 'qualiEndTimeout', 'endTimeout', 'chiusuraTimeout']
            .forEach(k => { if (g[k]) clearTimeout(g[k]); });
        Object.values(g.rejoinTimers || {}).forEach(clearTimeout);
    }
    activeGames.delete(LOBBY);
    lobbies.delete(LOBBY);
}

function entra(io, formato) {
    lobbies.set(LOBBY, {
        host: 'red', players: ['red'], lockedPlayers: ['red'],
        gameSettings: { trackId: 'prova', botsEnabled: 'false', gridSize: '4', formato },
    });
    const a = collega(io);
    a.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'red', uid: 'uid-andrea', token: creaGettone(LOBBY, 'red') });
    return a;
}

test('in formato stagione la partita nasce in fase "stagione", non alla scelta mescole', (t) => {
    t.after(pulisci);
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const io = ioFinto();
    const a = entra(io, 'stagione');

    const g = activeGames.get(LOBBY);
    assert.equal(g.phase, 'stagione');
    assert.equal(g.formato, 'stagione');

    const setup = a.emessi.find(m => m.evento === 'f1Setup');
    assert.equal(setup.dati.formato, 'stagione', 'il client deve sapere in che formato e\' entrato');

    // Il tempo passa: nessuna scadenza deve spingere avanti la sessione.
    t.mock.timers.tick(10 * 60 * 1000);
    assert.equal(g.phase, 'stagione', 'niente puo\' portare avanti la sessione finche\' non lo chiede l\'host');
});

test('in gara veloce non cambia niente: si parte dalla scelta mescole come sempre', (t) => {
    t.after(pulisci);
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const io = ioFinto();
    entra(io, 'veloce');
    assert.equal(activeGames.get(LOBBY).phase, 'tyre_select');
});

test('senza formato dichiarato si corre come si e\' sempre corso', (t) => {
    t.after(pulisci);
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const io = ioFinto();
    entra(io, undefined);
    assert.equal(activeGames.get(LOBBY).phase, 'tyre_select');
});

test('la stagione scelta dall\'host arriva a tutti, e solo l\'host puo\' sceglierla', (t) => {
    t.after(pulisci);
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const io = ioFinto();
    const a = entra(io, 'stagione');

    // Un secondo pilota, che non ospita.
    lobbies.get(LOBBY).players.push('blue');
    lobbies.get(LOBBY).lockedPlayers.push('blue');
    const b = collega(io);
    b.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'blue', uid: 'uid-amico', token: creaGettone(LOBBY, 'blue') });

    io.inviati.length = 0;
    b.handlers.f1StagioneScelta({ lobbyId: LOBBY, stagioneId: 'abusiva' });
    assert.equal(io.inviati.filter(m => m.evento === 'f1StagioneScelta').length, 0,
        'chi non ospita non decide quale campionato si corre');
    assert.equal(activeGames.get(LOBBY).stagioneId, null);

    a.handlers.f1StagioneScelta({ lobbyId: LOBBY, stagioneId: 'stag-1' });
    const annunci = io.inviati.filter(m => m.evento === 'f1StagioneScelta');
    assert.equal(annunci.length, 1);
    assert.equal(annunci[0].dest, LOBBY, 'l\'annuncio va a tutta la lobby');
    assert.equal(annunci[0].dati.stagioneId, 'stag-1');
    assert.equal(activeGames.get(LOBBY).stagioneId, 'stag-1');
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `node --test backend/sockets/games/f1GameSocket.stagione.test.js`
Expected: FAIL — la fase è `tyre_select`, non `stagione`.

- [ ] **Step 3: Aggiungere il formato alla partita**

In `backend/sockets/games/f1GameSocket.js`, nell'oggetto passato a `activeGames.set(lobbyId, {...})`, subito dopo `sessione:`, aggiungi:

```js
                // Gara veloce o stagione. Lo decide lo smistamento in lobby
                // (vedi frontend/lobby.js) e viaggia dentro lobby.gameSettings
                // come ogni altra impostazione: un solo canale, una sola fonte.
                //
                // In formato stagione la partita nasce in una fase che sta
                // PRIMA della scelta mescole: il weekend e' identico, gli si
                // mette solo una schermata davanti (Rif.
                // docs/superpowers/specs/2026-08-19-f1-stagioni-design.md).
                formato: (lobby && lobby.gameSettings && lobby.gameSettings.formato) === 'stagione' ? 'stagione' : 'veloce',
                stagioneId: null,
```

e cambia la riga della fase:

```js
                phase: 'tyre_select',   // tyre_select -> qualifying -> grid_display -> race -> race_end
```

in:

```js
                // stagione -> tyre_select -> qualifying -> grid_display -> race -> race_end
                // ('stagione' solo in formato stagione, e solo prima del primo weekend)
                phase: (lobby && lobby.gameSettings && lobby.gameSettings.formato) === 'stagione' ? 'stagione' : 'tyre_select',
```

- [ ] **Step 4: Non far partire la scelta mescole**

Nel blocco `if (!game.tick) { ... }`:

```js
        if (!game.tick) {
            game.tick = setInterval(() => {
                const t0 = process.hrtime.bigint();
                tickGame(io, lobbyId, game);
                const ms = Number(process.hrtime.bigint() - t0) / 1e6;
                recordTickDuration(lobbyId, Object.keys(game.players).length, game.phase, ms);
            }, PHYSICS_TICK_MS);
            // In formato stagione il weekend non parte da solo: prima si
            // sceglie il campionato. Ci pensera' f1StagioneCorri (passo 3).
            if (game.formato !== 'stagione') startTyreSelect(io, lobbyId, game);
        }
```

- [ ] **Step 5: Dichiarare il formato al client**

Dentro `socket.emit('f1Setup', {...})`, dopo `phase: game.phase,`:

```js
            // Il client monta le schermate della stagione solo se e' in
            // stagione: e' l'unica cosa che deve sapere per farlo.
            formato: game.formato,
            stagioneId: game.stagioneId,
```

- [ ] **Step 6: Aggiungere l'handler della scelta**

Accanto agli altri `socket.on(...)` (per esempio subito prima di `socket.on('f1ReturnToLobby', ...)`):

```js
    // Quale campionato si corre: lo sceglie chi ospita, e da quel momento vale
    // per tutti quelli che sono nella pagina. Il server non legge il documento
    // della stagione (lo fa il client, dalla rotta protetta): qui si tiene solo
    // l'id, che al passo 3 dira' quale pista caricare.
    socket.on('f1StagioneScelta', ({ lobbyId, stagioneId }) => {
        const game = activeGames.get(lobbyId);
        if (!game || game.gameId !== 'f1') return;
        if (socket.color !== game.hostColor) return;   // non decide chi non ospita
        if (!stagioneId || typeof stagioneId !== 'string') return;
        game.stagioneId = stagioneId;
        io.to(lobbyId).emit('f1StagioneScelta', { stagioneId });
    });
```

- [ ] **Step 7: Eseguire i test**

Run: `node --test backend/sockets/games/f1GameSocket.stagione.test.js`
Expected: PASS, 4/4.

- [ ] **Step 8: Verificare di non aver rotto il weekend**

Run: `node --test backend/sockets/games/`
Expected: nessun test rosso NUOVO rispetto a prima (i preesistenti noti: `Simcade: isolamento dei componenti`).

- [ ] **Step 9: Commit**

```bash
git add backend/sockets/games/f1GameSocket.js backend/sockets/games/f1GameSocket.stagione.test.js
git commit -m "Stagioni passo 2b/2: in formato stagione il weekend aspetta, non parte da solo"
```

---

### Task 3: Dalla lobby, *Season* avvia davvero

**Files:**
- Modify: `frontend/lobby.js:344-349` (il gestore di `f1-mode-season`)
- Modify: `frontend/lobby.html:186-188` (via l'avviso «coming soon»)

**Interfaces:**
- Consumes: `startGame { lobbyId, gameId, settings }`, già usato da `showGameSettings`.
- Produces: `lobby.gameSettings.formato = 'stagione'`, letto dal Task 2.

La stagione usa **la stessa strada di sempre** — `startGame` con le settings — aggiungendo solo `formato: 'stagione'`. La spec lo dice esplicitamente («la stagione passa di qui aggiungendo campi a `settings`, senza un secondo canale»): non inventare un evento nuovo.

- [ ] **Step 1: Sostituire il gestore**

In `frontend/lobby.js`, al posto di:

```js
        const f1Season = document.getElementById('f1-mode-season');
        if (f1Season) {
            f1Season.addEventListener('click', () => {
                document.getElementById('f1-season-soon').style.display = 'block';
            });
        }
```

metti questo (i nomi sono quelli veri: `saveGameSettings` sta a `lobby.js:422`, e l'avvio a `lobby.js:373` usa la variabile `lobbyId`):

```js
        const f1Season = document.getElementById('f1-mode-season');
        if (f1Season) {
            f1Season.addEventListener('click', () => {
                // La stagione NON apre un pannello qui: la lobby non sa chi
                // sei (conosce colori e gettoni, non gli account), e le
                // schermate del campionato hanno bisogno degli uid. Si avvia
                // la sessione e si atterra in f1.html, dove il token c'e' gia'
                // — vedi la sezione "Dove vivono le schermate" della spec.
                //
                // Pista: ne serve una per far nascere la partita, ma NON e'
                // quella che si correra' — il calendario lo sorteggia la
                // stagione. La prima gara vera la carichera' il passo 3.
                if (selectedColor !== currentHost) return;   // solo chi ospita avvia
                f1ModeModal.style.display = 'none';
                // saveGameSettings legge i <select> di #f1-settings e li
                // ricorda: sono le impostazioni F1 gia' scelte in lobby. La
                // stagione ci aggiunge solo il proprio formato.
                const settings = saveGameSettings('f1');
                socket.emit('startGame', {
                    lobbyId,
                    gameId: 'f1',
                    settings: Object.assign({}, settings, { formato: 'stagione' }),
                });
            });
        }
```

> Se in `lobby.js` non esiste una funzione che legge le impostazioni F1 salvate, usa lo stesso oggetto che `showGameSettings('f1')` passerebbe: l'importante è che `formato: 'stagione'` sia dentro `settings` e che il resto resti quello di sempre.

- [ ] **Step 2: Togliere l'avviso «coming soon»**

In `frontend/lobby.html` elimina il blocco:

```html
        <div id="f1-season-soon" class="f1-mode-note" style="display:none;">
            Seasons aren't playable yet — this is the next thing being built.
        </div>
```

Se la classe `.f1-mode-note` non è usata altrove, togli anche la sua regola da `frontend/styles/lobby.css`.

- [ ] **Step 3: Prova manuale**

Avvia `node server.js` dalla cartella `backend/`, apri `localhost:3000`, entra in lobby, premi F1 → *Season*.
Expected: la pagina di gioco si apre e resta in attesa (nessuna schermata mescole, nessun conto alla rovescia). Nel terminale nessun errore.

- [ ] **Step 4: Commit**

```bash
git add frontend/lobby.js frontend/lobby.html frontend/styles/lobby.css
git commit -m "Stagioni passo 2b/3: dalla lobby, Season avvia la sessione in formato stagione"
```

---

### Task 4: Le schermate — scelta e creazione

**Files:**
- Create: `frontend/shared/f1StagioneSchermate.js`
- Modify: `frontend/f1.html` (markup + `<script>` + bump `?v=`)
- Modify: `frontend/f1.js` (un solo aggancio, in `f1Setup`)
- Modify: `frontend/styles/f1.css`

**Interfaces:**
- Consumes: `F1Stagione.{intervalloGare, classifica, garaCorrente, finita, siPuoRiprendere}`, le rotte del Task 1, l'evento `f1StagioneScelta` del Task 2.
- Produces: `F1StagioneSchermate.monta({ socket, lobbyId, sonoHost, tokenDi, piste })` — restituisce `{ chiudi() }`.
  - `tokenDi: () => Promise<string>` — il token Firebase corrente
  - `piste: [{ id, name }]` — l'elenco da `GET /api/f1/tracks`

Il token c'è già: `frontend/f1.js:108` attende `firebase.auth().onAuthStateChanged` e tiene l'utente in `const user` (null se ospite). Il modulo delle schermate **non** importa Firebase da sé — riceve una `tokenDi()` che restituisce una `Promise<string>`, e chi gliela passa è `f1.js`:

```js
    // Il token vive in f1.js, che l'autenticazione ce l'ha gia' (vedi `user`
    // sopra). Le schermate ne ricevono solo il modo di chiederlo: cosi' non
    // esiste un secondo posto che sa di Firebase.
    // getIdToken() da solo restituisce quello in cache e lo rinnova quando
    // scade — non serve gestirne la scadenza a mano.
    const tokenFirebaseCorrente = () => (user ? user.getIdToken() : Promise.reject(new Error('Serve un account per le stagioni')));
```

- [ ] **Step 1: Scrivere il markup**

In `frontend/f1.html`, subito **dopo** il blocco `<div id="tyre-select-overlay">…</div>` (le schermate della stagione sono sue sorelle: stesso posto, stesso linguaggio):

```html
    <!-- SCHERMATE DELLA STAGIONE (formato stagione soltanto).
         Stanno qui e non in lobby perche' la lobby non sa chi sei: conosce
         colori e gettoni, non gli account, e una stagione e' salvata per
         account. Qui il token c'e' gia'. Vedi la sezione "Dove vivono le
         schermate" della spec delle stagioni. -->
    <div id="stagione-overlay" style="display:none;">
        <div class="stagione-foglio">
            <header class="stagione-testata">
                <span class="stagione-eyebrow">Campionato</span>
                <h2 class="stagione-titolo" id="stagione-titolo">Le tue stagioni</h2>
            </header>

            <!-- 1. SCELTA: creane una nuova o riprendi -->
            <section class="stagione-vista" id="stagione-vista-scelta">
                <div class="stagione-colonne">
                    <div class="stagione-col">
                        <div class="stagione-sezione">Riprendi</div>
                        <ul class="stagione-elenco" id="stagione-elenco"></ul>
                        <p class="stagione-vuoto" id="stagione-elenco-vuoto" style="display:none;">
                            Non hai ancora nessuna stagione salvata.
                        </p>
                    </div>
                    <div class="stagione-col">
                        <div class="stagione-sezione">Nuova stagione</div>
                        <label class="stagione-campo">
                            <span>Nome</span>
                            <input type="text" id="stagione-nome" maxlength="40" placeholder="Mondiale 2026">
                        </label>
                        <label class="stagione-campo">
                            <span>Quante gare</span>
                            <input type="number" id="stagione-gare" min="3" step="1">
                            <small id="stagione-gare-aiuto">—</small>
                        </label>
                        <label class="stagione-campo">
                            <span>Piloti in griglia</span>
                            <input type="number" id="stagione-piloti" min="1" max="20" step="1" value="6">
                        </label>
                        <button type="button" class="stagione-btn stagione-btn-primario" id="stagione-crea">
                            Crea la stagione
                        </button>
                        <p class="stagione-errore" id="stagione-errore" style="display:none;"></p>
                    </div>
                </div>
            </section>

            <!-- 2. CALENDARIO + CLASSIFICA -->
            <section class="stagione-vista" id="stagione-vista-calendario" style="display:none;">
                <div class="stagione-colonne">
                    <div class="stagione-col">
                        <div class="stagione-sezione">Calendario</div>
                        <ol class="stagione-calendario" id="stagione-calendario"></ol>
                    </div>
                    <div class="stagione-col">
                        <div class="stagione-sezione">Classifica</div>
                        <ol class="stagione-classifica" id="stagione-classifica"></ol>
                    </div>
                </div>
                <div class="stagione-comandi">
                    <span class="stagione-prossima" id="stagione-prossima"></span>
                    <button type="button" class="stagione-btn stagione-btn-primario" id="stagione-corri" disabled>
                        CORRI
                    </button>
                </div>
                <p class="stagione-nota" id="stagione-nota"></p>
            </section>

            <!-- 3. NON SEI TU A DECIDERE -->
            <section class="stagione-vista" id="stagione-vista-attesa" style="display:none;">
                <p class="stagione-attesa">In attesa che chi ospita scelga il campionato…</p>
            </section>
        </div>
    </div>
```

Poi, fra gli `<script>` (accanto a `shared/f1Stagione.js` se già presente, altrimenti prima di `f1.js`):

```html
    <script src="shared/f1Stagione.js?v=20260820a"></script>
    <script src="shared/f1StagioneSchermate.js?v=20260820a"></script>
```

e bump di `f1.js?v=` al valore successivo.

- [ ] **Step 2: Scrivere il modulo delle schermate**

Crea `frontend/shared/f1StagioneSchermate.js`. Solo DOM e rete: nessuna regola di campionato (quelle stanno in `f1Stagione.js`), nessuna scena 3D.

```js
// frontend/shared/f1StagioneSchermate.js
//
// Le schermate del campionato dentro la pagina di gioco: scegli/crea, poi
// calendario e classifica. Qui non vive NESSUNA regola: i punti, l'ordine e
// il calendario li calcola shared/f1Stagione.js, che gira uguale sul server.
// Questo file disegna e chiede, e basta.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.F1StagioneSchermate = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    const el = (id) => document.getElementById(id);

    function mostraVista(quale) {
        for (const v of ['scelta', 'calendario', 'attesa']) {
            const n = el('stagione-vista-' + v);
            if (n) n.style.display = (v === quale) ? '' : 'none';
        }
    }

    function testo(nodo, valore) { if (nodo) nodo.textContent = valore; }

    // Ogni chiamata alle rotte porta il token: e' l'unica cosa che dice al
    // server chi sei. Senza, la rotta risponde 401 ed e' giusto cosi'.
    async function chiedi(tokenDi, percorso, opzioni) {
        const token = await tokenDi();
        const intestazioni = Object.assign({ 'Authorization': 'Bearer ' + token }, (opzioni && opzioni.headers) || {});
        const risposta = await fetch(percorso, Object.assign({}, opzioni, { headers: intestazioni }));
        const dati = await risposta.json().catch(() => null);
        if (!risposta.ok) throw new Error((dati && dati.error) || 'Richiesta fallita');
        return dati;
    }

    function monta(opzioni) {
        const { socket, lobbyId, sonoHost, tokenDi, piste } = opzioni;
        const overlay = el('stagione-overlay');
        overlay.style.display = 'flex';

        let stagioneCorrente = null;

        // ---- la vista di scelta ------------------------------------------
        const intervallo = F1Stagione.intervalloGare(piste.length);
        el('stagione-gare').min = intervallo.min;
        el('stagione-gare').max = intervallo.max;
        el('stagione-gare').value = intervallo.consigliate;
        testo(el('stagione-gare-aiuto'), `da ${intervallo.min} a ${intervallo.max} — una pista non si ripete`);

        function errore(messaggio) {
            const n = el('stagione-errore');
            n.textContent = messaggio || '';
            n.style.display = messaggio ? '' : 'none';
        }

        async function caricaElenco() {
            const lista = el('stagione-elenco');
            lista.innerHTML = '';
            let stagioni = [];
            try {
                stagioni = (await chiedi(tokenDi, '/api/f1/stagioni')).stagioni || [];
            } catch (e) {
                errore('Non riesco a leggere le tue stagioni: ' + e.message);
                return;
            }
            el('stagione-elenco-vuoto').style.display = stagioni.length ? 'none' : '';
            for (const s of stagioni) {
                const li = document.createElement('li');
                li.className = 'stagione-voce';
                const fine = s.giro >= s.calendario.length;
                li.innerHTML = `<span class="stagione-voce-nome"></span>`
                    + `<span class="stagione-voce-stato">${fine ? 'conclusa' : `gara ${s.giro + 1} di ${s.calendario.length}`}</span>`;
                li.querySelector('.stagione-voce-nome').textContent = s.nome;
                li.addEventListener('click', () => scegli(s._id));
                lista.appendChild(li);
            }
        }

        async function crea() {
            errore('');
            el('stagione-crea').disabled = true;
            try {
                const corpo = {
                    lobbyId,
                    nome: el('stagione-nome').value,
                    quanteGare: Number(el('stagione-gare').value),
                    gridSize: Number(el('stagione-piloti').value),
                };
                const { stagione } = await chiedi(tokenDi, '/api/f1/stagioni', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(corpo),
                });
                scegli(stagione._id);
            } catch (e) {
                errore(e.message);
            } finally {
                el('stagione-crea').disabled = false;
            }
        }

        // Sceglierla e' un atto dell'host, e vale per tutti: il server lo
        // rimbalza a tutta la lobby (f1StagioneScelta).
        function scegli(id) {
            socket.emit('f1StagioneScelta', { lobbyId, stagioneId: id });
        }

        // ---- la vista calendario -----------------------------------------
        async function mostraStagione(id) {
            let stagione;
            try {
                stagione = (await chiedi(tokenDi, '/api/f1/stagioni/' + encodeURIComponent(id))).stagione;
            } catch (e) {
                errore('Non riesco ad aprire la stagione: ' + e.message);
                mostraVista('scelta');
                return;
            }
            stagioneCorrente = stagione;
            testo(el('stagione-titolo'), stagione.nome);

            const cal = el('stagione-calendario');
            cal.innerHTML = '';
            stagione.calendario.forEach((pistaId, i) => {
                const li = document.createElement('li');
                li.className = 'stagione-tappa'
                    + (i < stagione.giro ? ' corsa' : '')
                    + (i === stagione.giro ? ' prossima' : '');
                const nome = (piste.find(p => p.id === pistaId) || {}).name || pistaId;
                li.innerHTML = `<span class="stagione-tappa-n">${i + 1}</span><span class="stagione-tappa-nome"></span>`;
                li.querySelector('.stagione-tappa-nome').textContent = nome;
                cal.appendChild(li);
            });

            const cls = el('stagione-classifica');
            cls.innerHTML = '';
            for (const riga of F1Stagione.classifica(stagione)) {
                const li = document.createElement('li');
                li.className = 'stagione-riga';
                li.innerHTML = `<span class="stagione-pos">${riga.posizione}</span>`
                    + `<span class="stagione-pallino"></span>`
                    + `<span class="stagione-nome"></span>`
                    + `<span class="stagione-punti">${riga.punti}</span>`;
                li.querySelector('.stagione-pallino').style.background = riga.colore || '#888';
                li.querySelector('.stagione-nome').textContent = riga.bot ? (riga.nome || 'Bot') : (riga.colore || '—');
                cls.appendChild(li);
            }

            const finita = F1Stagione.finita(stagione);
            const prossima = F1Stagione.garaCorrente(stagione);
            testo(el('stagione-prossima'), finita
                ? 'Stagione conclusa'
                : `Prossima: ${(piste.find(p => p.id === prossima) || {}).name || prossima}`);
            // CORRI arriva al passo 3: qui il posto c'e' gia', spento, cosi'
            // la schermata e' quella definitiva e non un'altra da rifare.
            el('stagione-corri').disabled = true;
            testo(el('stagione-nota'), 'Correre una gara arriva col prossimo passo.');
            mostraVista('calendario');
        }

        el('stagione-crea').addEventListener('click', crea);
        socket.on('f1StagioneScelta', ({ stagioneId }) => { if (stagioneId) mostraStagione(stagioneId); });

        if (sonoHost) {
            mostraVista('scelta');
            caricaElenco();
        } else {
            mostraVista('attesa');
        }

        return {
            chiudi() { overlay.style.display = 'none'; },
        };
    }

    return { monta };
});
```

- [ ] **Step 3: Agganciare le schermate in f1.js**

Nell'handler `socket.on('f1Setup', …)` di `frontend/f1.js`, dopo che `myColor`/`hostColor` sono stati assegnati:

```js
        // Formato stagione: il weekend non parte finche' non si sceglie il
        // campionato. Le schermate vivono in un modulo a parte — qui c'e'
        // solo l'aggancio, perche' questo file e' gia' abbastanza grande.
        if (data.formato === 'stagione' && !schermateStagione) {
            fetch('/api/f1/tracks').then(r => r.json()).then((piste) => {
                schermateStagione = F1StagioneSchermate.monta({
                    socket, lobbyId,
                    sonoHost: myColor === hostColor,
                    tokenDi: tokenFirebaseCorrente,
                    piste,
                });
            });
        }
```

dichiarando accanto alle altre variabili di stato:

```js
    let schermateStagione = null;
```

- [ ] **Step 4: Scrivere il CSS**

In coda a `frontend/styles/f1.css`. Riusa le **stesse variabili** della schermata mescole (`--sel-*`, definite su `#tyre-select-overlay` a `f1.css:68`): ridichiararle qui è ciò che fa divergere due schermate che devono sembrare la stessa pagina.

```css
/* ====================================================================
   SCHERMATE DELLA STAGIONE
   Sorelle della schermata mescole: stesso fondo, stessa testata, stessa
   barretta rossa davanti alle sezioni. Le variabili sono le sue — vedi
   #tyre-select-overlay piu' su — perche' due palette separate divergono
   alla prima modifica.
   ==================================================================== */
#stagione-overlay {
    --sel-fondo-a: #123138;
    --sel-fondo-b: #08191E;
    --sel-lavagna: #163A44;
    --sel-rilievo: #1E4B57;
    --sel-filo: rgba(255, 255, 255, 0.10);
    --sel-testo: #E9F3F5;
    --sel-tenue: #8CAEB6;
    --sel-cordolo: #E23127;

    position: fixed;
    inset: 0;
    z-index: 40;                 /* lo stesso di #tyre-select-overlay: mai a schermo insieme */
    align-items: center;
    justify-content: center;
    padding: clamp(10px, 2.5vh, 34px);
    color: var(--sel-testo);
    background: radial-gradient(120% 90% at 22% 15%, var(--sel-fondo-a), var(--sel-fondo-b) 72%);
}

.stagione-foglio {
    width: 100%;
    max-width: 1180px;
    display: flex;
    flex-direction: column;
    gap: clamp(10px, 1.6vh, 22px);
}

.stagione-testata { display: flex; flex-direction: column; gap: 4px; }
.stagione-eyebrow {
    font-size: 11px; font-weight: 800; letter-spacing: 3px;
    text-transform: uppercase; color: var(--sel-tenue);
}
.stagione-titolo { margin: 0; font-size: clamp(22px, 3.4vh, 38px); font-weight: 800; }

.stagione-colonne { display: grid; grid-template-columns: 1fr 1fr; gap: clamp(14px, 2vw, 32px); }
.stagione-col { display: flex; flex-direction: column; gap: clamp(6px, 1vh, 14px); min-width: 0; }

/* La stessa intestazione di sezione delle mescole: e' quello che tiene
   insieme le due colonne come una pagina sola. */
.stagione-sezione {
    display: flex; align-items: center; gap: 8px;
    font-size: 12px; font-weight: 800; letter-spacing: 3px;
    text-transform: uppercase; color: var(--sel-testo);
}
.stagione-sezione::before {
    content: ''; width: 14px; height: 3px;
    background: var(--sel-cordolo); border-radius: 2px;
}

/* --- elenco delle proprie stagioni --- */
.stagione-elenco { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.stagione-voce {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 10px 14px; border-radius: 10px; cursor: pointer;
    background: var(--sel-lavagna); border: 1px solid var(--sel-filo);
    transition: background 120ms ease, transform 120ms ease;
}
.stagione-voce:hover { background: var(--sel-rilievo); transform: translateX(2px); }
.stagione-voce-nome { font-weight: 700; }
.stagione-voce-stato { font-size: 12px; color: var(--sel-tenue); white-space: nowrap; }
.stagione-vuoto { margin: 0; font-size: 13px; color: var(--sel-tenue); }

/* --- il modulo di creazione --- */
.stagione-campo { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--sel-tenue); }
.stagione-campo input {
    padding: 9px 12px; border-radius: 8px; font-size: 15px; font-weight: 600;
    color: var(--sel-testo); background: var(--sel-lavagna);
    border: 1px solid var(--sel-filo); outline: none;
}
.stagione-campo input:focus { border-color: var(--sel-cordolo); }
.stagione-campo small { color: var(--sel-tenue); }

.stagione-btn {
    padding: 11px 18px; border-radius: 10px; cursor: pointer;
    font-size: 13px; font-weight: 800; letter-spacing: 2px; text-transform: uppercase;
    color: var(--sel-testo); background: var(--sel-lavagna); border: 1px solid var(--sel-filo);
}
.stagione-btn:hover:not(:disabled) { background: var(--sel-rilievo); }
.stagione-btn:disabled { opacity: 0.45; cursor: default; }
.stagione-btn-primario { background: var(--sel-cordolo); border-color: transparent; }
.stagione-btn-primario:hover:not(:disabled) { filter: brightness(1.12); background: var(--sel-cordolo); }

.stagione-errore { margin: 0; font-size: 13px; color: #FF8A80; }
.stagione-nota, .stagione-attesa { margin: 0; font-size: 13px; color: var(--sel-tenue); }
.stagione-attesa { text-align: center; padding: 32px 0; }

/* --- calendario --- */
.stagione-calendario { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.stagione-tappa {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 12px; border-radius: 8px;
    background: var(--sel-lavagna); border: 1px solid transparent;
}
.stagione-tappa-n {
    min-width: 22px; text-align: center; font-size: 12px; font-weight: 800;
    color: var(--sel-tenue);
}
.stagione-tappa.corsa { opacity: 0.45; }              /* gia' andata */
.stagione-tappa.prossima { border-color: var(--sel-cordolo); }   /* quella che si corre adesso */

/* --- classifica --- */
.stagione-classifica { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.stagione-riga {
    display: grid; grid-template-columns: 28px 14px 1fr auto;
    align-items: center; gap: 10px;
    padding: 8px 12px; border-radius: 8px; background: var(--sel-lavagna);
}
.stagione-pos { font-size: 12px; font-weight: 800; color: var(--sel-tenue); text-align: center; }
.stagione-pallino { width: 12px; height: 12px; border-radius: 50%; }
.stagione-nome { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.stagione-punti { font-weight: 800; font-variant-numeric: tabular-nums; }

.stagione-comandi { display: flex; align-items: center; justify-content: flex-end; gap: 16px; }
.stagione-prossima { font-size: 13px; color: var(--sel-tenue); }

@media (max-width: 900px) {
    .stagione-colonne { grid-template-columns: 1fr; }
}
```

⚠️ Prima di aggiungere una regola, **cerca se ne esiste già una che la vince per ordine**: è già costata tre correzioni cadute nel vuoto (`feedback_css_morto_che_vince`).

- [ ] **Step 5: Bump del cache-busting**

In `frontend/f1.html`, alza il `?v=` di `f1.js`, di `styles/f1.css` e dei due script nuovi. Senza questo il browser serve la versione vecchia e sembra che non funzioni niente (`feedback_hard_refresh_prima_di_dire_non_funziona`).

- [ ] **Step 6: Vedere la schermata prima di consegnarla**

Chrome headless è installato: renderizza la pagina e guardala davvero, invece di dedurre com'è venuta (`feedback_chrome_headless_per_vedere_la_ui`).

```bash
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless --disable-gpu \
  --window-size=1600,900 --screenshot=/tmp/stagione.png "http://localhost:3000/f1.html?..."
```

Se servire la pagina vera è scomodo, costruisci una paginetta di prova che includa `f1.css` e il markup di `#stagione-overlay` con dati finti — è il metodo già usato nel progetto. Controlla: colonne allineate, niente testo che deborda, il pulsante CORRI spento ma leggibile.

- [ ] **Step 7: Commit**

```bash
git add frontend/shared/f1StagioneSchermate.js frontend/f1.html frontend/f1.js frontend/styles/f1.css
git commit -m "Stagioni passo 2b/4: le schermate del campionato dentro la pagina di gioco"
```

---

### Task 5: La guardia degli stessi giocatori

**Files:**
- Modify: `frontend/shared/f1StagioneSchermate.js`
- Modify: `backend/routes/f1Stagioni.js` (la lettura singola risponde anche con chi manca)
- Modify: `backend/routes/f1Stagioni.test.js`

**Interfaces:**
- Consumes: `F1Stagione.siPuoRiprendere(stagione, uidPresenti)` → `{ ok, mancanti, inPiu }`
- Produces: `GET /api/f1/stagioni/:id?lobbyId=…` → `{ stagione, ripresa: { ok, mancanti, inPiu } }`

- [ ] **Step 1: Scrivere il test che fallisce**

Aggiungi a `backend/routes/f1Stagioni.test.js`:

```js
test('riprendere una stagione con i giocatori sbagliati si puo\' vedere ma non fare', async (t) => {
    t.after(pulisci);
    const server = await avviaServer();
    t.after(() => server.close());
    preparaPartita([{ colore: '#e74c3c', uid: 'uid-andrea' }, { colore: '#3498db', uid: 'uid-amico' }]);
    const creata = await chiedi(server, {
        metodo: 'POST', percorso: '/api/f1/stagioni', uid: 'uid-andrea',
        corpo: { lobbyId: LOBBY, nome: 'In due', quanteGare: 3, gridSize: 4 },
    });
    const id = creata.dati.stagione._id;

    // L'amico se ne va: in pista resta solo Andrea.
    preparaPartita([{ colore: '#e74c3c', uid: 'uid-andrea' }]);

    const r = await chiedi(server, { percorso: `/api/f1/stagioni/${id}?lobbyId=${LOBBY}`, uid: 'uid-andrea' });
    assert.equal(r.stato, 200, 'la stagione si deve poter APRIRE: si vede che c\'e\'');
    assert.equal(r.dati.ripresa.ok, false);
    assert.deepEqual(r.dati.ripresa.mancanti, ['uid-amico'], 'e deve dire CHI manca');
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `node --test backend/routes/f1Stagioni.test.js`
Expected: FAIL — `r.dati.ripresa` è `undefined`.

- [ ] **Step 3: Rispondere anche con la guardia**

In `backend/routes/f1Stagioni.js`, dentro `GET /api/f1/stagioni/:id`, prima di `res.json`:

```js
            // Se la richiesta dice da quale lobby arriva, si risponde anche se
            // quella stagione e' ripartibile QUI e ORA. La regola e' dettata
            // dall'utente: si riprende solo con esattamente gli stessi
            // giocatori (ne' uno in meno, ne' uno in piu'). Vedi
            // F1Stagione.siPuoRiprendere.
            //
            // Si RISPONDE lo stesso, con l'esito accanto: una stagione che non
            // si puo' riprendere deve comunque comparire e dire perche', se no
            // sembra sparita.
            let ripresa = null;
            const game = activeGames.get(req.query.lobbyId);
            if (game && game.gameId === 'f1') {
                const uidPresenti = Object.values(game.players)
                    .filter(p => !p.isBot && p.uid).map(p => p.uid);
                ripresa = F1Stagione.siPuoRiprendere(stagione, uidPresenti);
            }
            res.json({ stagione, ripresa });
```

- [ ] **Step 4: Eseguire il test**

Run: `node --test backend/routes/f1Stagioni.test.js`
Expected: PASS, 7/7.

- [ ] **Step 5: Mostrarlo nella schermata**

In `frontend/shared/f1StagioneSchermate.js`, dentro `mostraStagione`, cambia la chiamata in:

```js
                const risposta = await chiedi(tokenDi, '/api/f1/stagioni/'
                    + encodeURIComponent(id) + '?lobbyId=' + encodeURIComponent(lobbyId));
                stagione = risposta.stagione;
                var ripresa = risposta.ripresa;
```

e, dove oggi scrive la nota:

```js
            if (ripresa && !ripresa.ok) {
                const quanti = ripresa.mancanti.length;
                testo(el('stagione-nota'), quanti
                    ? `Manca ${quanti === 1 ? 'un pilota' : quanti + ' piloti'} di questa stagione: si riprende solo con gli stessi giocatori.`
                    : 'In pista c\'e\' qualcuno che non fa parte di questa stagione: si riprende solo con gli stessi giocatori.');
            } else {
                testo(el('stagione-nota'), 'Correre una gara arriva col prossimo passo.');
            }
```

- [ ] **Step 6: Commit**

```bash
git add backend/routes/f1Stagioni.js backend/routes/f1Stagioni.test.js frontend/shared/f1StagioneSchermate.js
git commit -m "Stagioni passo 2b/5: una stagione si riprende solo con gli stessi giocatori, e la schermata dice chi manca"
```

---

### Task 6: Il playtest e la chiusura del passo

**Files:** nessuna modifica prevista — questo task è la verifica, e le eventuali correzioni che ne nascono.

- [ ] **Step 1: Suite intera**

Run: `node --test backend/`
Expected: nessun rosso NUOVO. I preesistenti noti al 2026-08-19 sono 6: `segnalazioniRoutes.test.js`, `Simcade: isolamento dei componenti`, i due `loadTrack("monte-rosso")`, `identitaLobby.test.js`, `simulateLap … tuning`. Confrontare con un worktree pulito su `main` prima di attribuirsi una regressione.

- [ ] **Step 2: Il playtest della spec**

`node server.js` da `backend/`, poi `localhost:3000`. Da fare nell'ordine:

1. Lobby → F1 → *Season* → si atterra in `f1.html` e compare la schermata del campionato (non le mescole).
2. Creare una stagione: nome, 3 gare, 6 piloti → compare il calendario con 3 piste distinte e la classifica a zero.
3. **Ricaricare la pagina** (F5) → la stagione si ritrova nell'elenco *Riprendi*, con lo stesso nome e lo stesso calendario.
4. Lobby → F1 → *Quick Race* → il weekend parte esattamente come prima: mescole, qualifica, gara.

⚠️ Il punto 3 funziona solo finché il server non viene riavviato: senza `MONGODB_URI` le stagioni stanno in memoria (vedi Global Constraints). Se serve provare la persistenza vera, va messo `MONGODB_URI` nel `.env`.

- [ ] **Step 3: Riferire all'utente e fermarsi**

Il passo 2b finisce qui. *CORRI* è spento di proposito: accenderlo è il passo 3, che ha il suo playtest («due gare di fila, e una chiusa a metà che non deve contare»).

Riferire **il risultato, non il percorso** (`feedback_riportare_il_risultato_non_il_come`): cosa si può fare adesso che prima non si poteva, cosa è rimasto spento e perché.
