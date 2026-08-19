# F1 Stagioni — passo 3: il weekend dentro la stagione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** *Corri* lancia il weekend sulla pista del calendario; a fine gara il risultato viene registrato nella stagione, salvato, e si torna al calendario con la classifica aggiornata. Chi chiude il browser a metà weekend non perde la stagione: perde quel weekend.

**Architecture:** Il weekend non viene mai modificato — viene **riavviato**. *Corri* fa fare al server esattamente ciò che fa `startGame` dalla lobby (scrivere `lobby.gameSettings`, timbrare `lobby.sessioneF1`) e poi dice ai client di ricaricare la pagina: da lì in poi gira il flusso di sempre, sulla pista del calendario, senza una riga di codice diversa. A fine gara lo stesso meccanismo al contrario riporta al calendario. Il documento della stagione lo tocca **solo il server**, in un punto solo, subito dopo la bandiera a scacchi.

**Tech Stack:** Node.js + Socket.io, `backend/store/seasonStore.js`, regole in `frontend/shared/f1Stagione.js`, `node:test`.

**Spec:** `docs/superpowers/specs/2026-08-19-f1-stagioni-design.md` (passo 3)

## La decisione che regge tutto il piano

Per correre la gara del calendario bisogna cambiare pista. Due strade:

- **A — ricostruire la scena a caldo.** Scaricare la pista in corso, ricostruire terreno, asfalto, barriere, scenografia e box senza lasciare la pagina. È un progetto a sé: `f1.js` costruisce il mondo una volta sola all'avvio, e l'ordine in cui lo fa (notturno letto prima delle luci, scenografia dopo la geometria) è pieno di dipendenze. Vorrebbe dire mettere le mani proprio dentro il weekend.
- **B — ricaricare la pagina** (scelta). Il server aggiorna `lobby.gameSettings` e incrementa `lobby.sessioneF1` — le due cose che fa `startGame` — e i client fanno `location.reload()`. Il caricamento fra una gara e l'altra è lo stesso che c'è già oggi fra lobby e gara.

**B rispetta il vincolo della spec** («il codice del weekend non si tocca») e costa un caricamento. A lo violerebbe. La spec dice «fra una gara e l'altra non si esce mai dalla pagina» per non tornare in **lobby**: ricaricare `f1.html` non è uscirne.

## Global Constraints

- **Il codice del weekend non si tocca.** Nessuna modifica a qualifica, gara, pit stop, podio — a parte il punto unico in cui il risultato viene registrato.
- **La classifica non si salva, si calcola** (`feedback_una_cosa_una_misura`).
- **Un solo punto di salvataggio**: subito dopo che una gara è finita. Mai a metà weekend — è ciò che rende vera la regola «chi chiude il browser perde il weekend, non la stagione».
- **Il documento della stagione lo scrive solo il server.** Il client lo legge dalle rotte protette e basta.
- **Italiano**, niente emoji, commit ad ogni task, `git add` per nome, push solo dell'utente.
- **Cache-busting** in `frontend/f1.html` ad ogni modifica di `f1.js` o di uno script `shared/`.
- I 5 test rossi preesistenti al 2026-08-20 non sono regressioni: `Simcade: isolamento dei componenti`, i due `loadTrack("monte-rosso")`, `identitaLobby.test.js`, `simulateLap … tuning`.

---

## Struttura dei file

| File | Responsabilità |
|---|---|
| `backend/sockets/games/f1GameSocket.js` | `f1StagioneCorri` (dal calendario alla pista), la nascita della partita "gara di campionato", e la chiamata a registrare il risultato dentro `endRace`. |
| `backend/sockets/games/f1Stagione.server.js` *(nuovo)* | Tutto ciò che una partita deve sapere della stagione: preparare le impostazioni della prossima gara, mappare i piloti, registrare il risultato. Fuori da `f1GameSocket.js`, che è già enorme. |
| `backend/sockets/games/f1Stagione.server.test.js` *(nuovo)* | Il ponte fra gara e campionato: chi vince prende 25, chi abbandona non registra niente. |
| `backend/sockets/games/f1Bot.js` | I bot della stagione hanno colori e nomi FISSI, dettati dal documento invece che sorteggiati. |
| `frontend/shared/f1StagioneSchermate.js` | *Corri* acceso; il ritorno al calendario dopo la gara. |
| `frontend/f1.js` | Il reload comandato dal server, e il rientro nel calendario a gara finita. |

---

### Task 1: I bot della stagione hanno un'identità fissa

**Files:**
- Modify: `backend/sockets/games/f1Bot.js` (`createBots`)
- Create: `backend/sockets/games/f1Bot.stagione.test.js`

**Interfaces:**
- Produces: `createBots(game, lobby, TYRE_COMPOUNDS, rng)` continua a funzionare come oggi; se `game.botStagione` è un array `[{colore, nome}]`, usa QUELLI invece di sorteggiare colori.

**Perché per primo:** è l'unico punto in cui la stagione deve dire qualcosa a chi crea la griglia (spec, «Il modello dei dati»), e senza di esso la classifica del campionato cambierebbe piloti ad ogni gara.

- [ ] **Step 1: Scrivere il test che fallisce**

```js
// backend/sockets/games/f1Bot.stagione.test.js
//
// In campionato i bot sono SEMPRE gli stessi: stessi colori, stessi nomi, per
// tutte le gare. Senza, la classifica sommerebbe i punti di piloti diversi con
// lo stesso nome — e "Bot 3" della seconda gara non sarebbe quello della prima.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBots } = require('./f1Bot.js');

const TYRE = { soft: {}, medium: {}, hard: {} };

function partitaFinta(colori) {
    return {
        players: Object.fromEntries(colori.map(c => [c, { color: c, isBot: false }])),
        track: { qualiSpawn: { x: 0, z: 0, angle: 0 }, points: [], totalLaps: 5 },
        gridSize: 4,
        settings: {},
    };
}

test('con una lista di bot della stagione si usano quei colori, non un sorteggio', () => {
    const game = partitaFinta(['#e74c3c']);
    game.botStagione = [
        { colore: '#111111', nome: 'Bot 1' },
        { colore: '#222222', nome: 'Bot 2' },
        { colore: '#333333', nome: 'Bot 3' },
    ];
    createBots(game, { lockedPlayers: ['#e74c3c'] }, TYRE);

    const bot = Object.values(game.players).filter(p => p.isBot);
    assert.deepEqual(bot.map(p => p.color).sort(), ['#111111', '#222222', '#333333']);
    assert.deepEqual(bot.map(p => p.nomeStagione).sort(), ['Bot 1', 'Bot 2', 'Bot 3']);
});

test('senza lista della stagione i bot nascono come sempre', () => {
    const game = partitaFinta(['#e74c3c']);
    createBots(game, { lockedPlayers: ['#e74c3c'] }, TYRE);
    const bot = Object.values(game.players).filter(p => p.isBot);
    assert.equal(bot.length, 3, 'gridSize 4 meno un umano');
    assert.ok(bot.every(p => !p.nomeStagione), 'fuori dal campionato un bot non ha nome');
});
```

- [ ] **Step 2: Eseguire e verificare che fallisca**

Run: `node --test backend/sockets/games/f1Bot.stagione.test.js`
Expected: FAIL — i colori sono quelli sorteggiati dalla palette.

- [ ] **Step 3: Implementare**

In `createBots`, dove oggi c'è `const colors = pickBotColors(humanColors, botsNeeded, rng);`:

```js
    // In CAMPIONATO i bot non si sorteggiano: sono quelli fissati alla
    // creazione della stagione, con lo stesso colore e lo stesso nome per
    // tutte le gare. E' l'unico punto in cui la stagione parla a chi crea la
    // griglia (Rif. docs/superpowers/specs/2026-08-19-f1-stagioni-design.md).
    // Senza, la classifica sommerebbe i punti di piloti diversi.
    const daStagione = Array.isArray(game.botStagione) ? game.botStagione.slice(0, botsNeeded) : null;
    const colors = daStagione ? daStagione.map(b => b.colore) : pickBotColors(humanColors, botsNeeded, rng);
```

e dentro il ciclo `for (const color of colors)`, subito dopo `game.players[color] = { ... }`, aggiungi:

```js
        // Il nome del bot vale SOLO in campionato: fuori resta null, e il
        // gioco continua a identificare i piloti dal colore come ha sempre
        // fatto (mai nickname, solo colore).
        if (daStagione) {
            const b = daStagione.find(x => x.colore === color);
            game.players[color].nomeStagione = b ? b.nome : null;
        }
```

- [ ] **Step 4: Eseguire i test**

Run: `node --test backend/sockets/games/f1Bot.stagione.test.js` → PASS 2/2
Run: `node --test backend/sockets/games/` → nessun rosso nuovo.

- [ ] **Step 5: Commit**

```bash
git add backend/sockets/games/f1Bot.js backend/sockets/games/f1Bot.stagione.test.js
git commit -m "Stagioni passo 3/1: in campionato i bot sono sempre gli stessi"
```

---

### Task 2: Il ponte fra campionato e weekend

**Files:**
- Create: `backend/sockets/games/f1Stagione.server.js`
- Create: `backend/sockets/games/f1Stagione.server.test.js`

**Interfaces:**
- Consumes: `seasonStore.{leggi, salva}`, `F1Stagione.{garaCorrente, finita, registraRisultato}`
- Produces:
  - `impostazioniPerLaProssimaGara(stagione, settingsCorrenti)` → `{...settings, trackId, gridSize, botsEnabled, formato: 'stagione', stagioneId, stagioneInCorso: true}` (o `null` se la stagione è finita)
  - `idPilotaDi(stagione, giocatore)` → l'id del pilota nella stagione (`'p3'`), o `null`
  - `ordineDelPodio(stagione, podium)` → array di id, dal primo all'ultimo
  - `async registraGara(stagione, podium)` → la stagione nuova, già salvata

**Perché un file a parte:** `f1GameSocket.js` sfiora le 2700 righe. Il campionato è una cosa che sta *attorno* alla partita, non dentro: tenerlo separato è anche ciò che permette di provarlo senza montare un socket.

- [ ] **Step 1: Scrivere il test che fallisce**

```js
// backend/sockets/games/f1Stagione.server.test.js
//
// Il ponte fra una gara finita e il campionato. Due cose da proteggere: che i
// piloti della gara si riconoscano in quelli della stagione (gli umani per
// uid, i bot per colore — l'unica identita' stabile che hanno), e che
// l'ordine d'arrivo diventi punti senza che nessuno li ricalcoli a mano.
const test = require('node:test');
const assert = require('node:assert/strict');
const F1Stagione = require('../../../frontend/shared/f1Stagione.js');
const seasonStore = require('../../store/seasonStore.js');
const ponte = require('./f1Stagione.server.js');

function stagioneFinta() {
    return F1Stagione.creaStagione({
        nome: 'Prova', creataDa: 'uid-andrea',
        piloti: [
            { uid: 'uid-andrea', colore: '#e74c3c', bot: false },
            { uid: null, colore: '#111111', bot: true, nome: 'Bot 1' },
            { uid: null, colore: '#222222', bot: true, nome: 'Bot 2' },
        ],
        calendario: ['monte-rosso', 'new-monza', 'prova'],
        impostazioni: { botsEnabled: true, gridSize: 3 },
    });
}

test('la prossima gara detta pista e griglia alle impostazioni', () => {
    const s = stagioneFinta();
    const settings = ponte.impostazioniPerLaProssimaGara(s, { trackId: 'vecchia', qualcosaDaTenere: 'si' });
    assert.equal(settings.trackId, 'monte-rosso', 'la pista e quella del calendario, non quella di prima');
    assert.equal(String(settings.gridSize), '3');
    assert.equal(settings.formato, 'stagione');
    assert.equal(settings.stagioneInCorso, true, 'la pagina che riparte deve sapere che si CORRE, non che si sceglie');
    assert.equal(settings.qualcosaDaTenere, 'si', 'il resto delle impostazioni non si butta');
    // I bot viaggiano nelle impostazioni: createBots e' sincrona e non puo'
    // aspettare Mongo nel mezzo di un join.
    assert.deepEqual(settings.botStagione, [
        { colore: '#111111', nome: 'Bot 1' },
        { colore: '#222222', nome: 'Bot 2' },
    ]);
});

test('a stagione finita non c e una prossima gara', () => {
    const s = Object.assign({}, stagioneFinta(), { giro: 3 });
    assert.equal(ponte.impostazioniPerLaProssimaGara(s, {}), null);
});

test('gli umani si riconoscono per uid, i bot per colore', () => {
    const s = stagioneFinta();
    assert.equal(ponte.idPilotaDi(s, { uid: 'uid-andrea', color: '#000000', isBot: false }), 'p1',
        'un umano e il suo uid, anche se in lobby ha cambiato colore');
    assert.equal(ponte.idPilotaDi(s, { uid: null, color: '#222222', isBot: true }), 'p3');
    assert.equal(ponte.idPilotaDi(s, { uid: 'uid-estraneo', color: '#999999', isBot: false }), null);
});

test('l ordine del podio diventa l ordine dei piloti della stagione', () => {
    const s = stagioneFinta();
    const podium = [
        { color: '#111111', uid: null, isBot: true },
        { color: '#e74c3c', uid: 'uid-andrea', isBot: false },
        { color: '#222222', uid: null, isBot: true },
    ];
    assert.deepEqual(ponte.ordineDelPodio(s, podium), ['p2', 'p1', 'p3']);
});

test('registrare una gara avanza il calendario e assegna i punti veri', async (t) => {
    t.after(() => seasonStore._svuota());
    const s = await seasonStore.salva(stagioneFinta());
    const podium = [
        { color: '#e74c3c', uid: 'uid-andrea', isBot: false },
        { color: '#111111', uid: null, isBot: true },
        { color: '#222222', uid: null, isBot: true },
    ];

    const dopo = await ponte.registraGara(s, podium);
    assert.equal(dopo.giro, 1, 'si passa alla gara dopo');
    assert.equal(dopo.risultati.length, 1);
    assert.equal(dopo.risultati[0].pista, 'monte-rosso');

    const classifica = F1Stagione.classifica(dopo);
    assert.equal(classifica[0].uid, 'uid-andrea');
    assert.equal(classifica[0].punti, 25);
    assert.equal(classifica[1].punti, 18);

    // E' stata SALVATA, non solo restituita: e' l'unico punto di salvataggio
    // di tutta la stagione, se non scrive qui non scrive mai.
    const riletta = await seasonStore.leggi(s._id);
    assert.equal(riletta.giro, 1);
});

test('una gara di una stagione gia finita non si registra', async (t) => {
    t.after(() => seasonStore._svuota());
    const s = await seasonStore.salva(Object.assign({}, stagioneFinta(), { giro: 3 }));
    await assert.rejects(() => ponte.registraGara(s, []));
});
```

- [ ] **Step 2: Eseguire e verificare che fallisca**

Run: `node --test backend/sockets/games/f1Stagione.server.test.js`
Expected: FAIL — `Cannot find module './f1Stagione.server.js'`

- [ ] **Step 3: Scrivere il modulo**

```js
// backend/sockets/games/f1Stagione.server.js
//
// Tutto quello che una PARTITA deve sapere del campionato: quale pista si
// corre adesso, chi sono i suoi piloti, e come un ordine d'arrivo diventa una
// riga di risultati.
//
// Sta fuori da f1GameSocket.js per due ragioni: quel file e' gia' enorme, e
// il campionato sta ATTORNO alla partita, non dentro — cosi' si prova senza
// montare un socket.
//
// Le REGOLE (punti, classifica, calendario) non sono qui: stanno in
// frontend/shared/f1Stagione.js, che gira uguale sul client. Qui c'e' solo il
// collegamento fra i due mondi.
const F1Stagione = require('../../../frontend/shared/f1Stagione.js');
const seasonStore = require('../../store/seasonStore');

// Le impostazioni con cui far ripartire la pagina per la PROSSIMA gara.
// Partono da quelle correnti — la lobby ne ha altre che non ci riguardano e
// buttarle sarebbe un modo silenzioso di cambiarle.
function impostazioniPerLaProssimaGara(stagione, settingsCorrenti) {
    if (F1Stagione.finita(stagione)) return null;
    return Object.assign({}, settingsCorrenti || {}, {
        trackId: F1Stagione.garaCorrente(stagione),
        gridSize: String((stagione.impostazioni && stagione.impostazioni.gridSize) || 6),
        botsEnabled: (stagione.impostazioni && stagione.impostazioni.botsEnabled) === false ? 'false' : 'true',
        formato: 'stagione',
        stagioneId: stagione._id,
        // La differenza fra "sono in campionato e scelgo" e "sono in
        // campionato e sto correndo": senza, la pagina che riparte
        // riaprirebbe il calendario invece della pista.
        stagioneInCorso: true,
        // I bot viaggiano QUI dentro e non si rileggono da Mongo al momento
        // del join: createBots e' sincrona e sta nel mezzo di joinF1Game, dove
        // aspettare il database vorrebbe dire far attendere ogni giocatore che
        // entra. Le impostazioni il server ce le ha gia' in mano.
        botStagione: (stagione.piloti || [])
            .filter(p => p.bot)
            .map(p => ({ colore: p.colore, nome: p.nome })),
    });
}

// Chi e' questo pilota, dentro la stagione.
//
// Gli umani per UID e i bot per COLORE, e non e' un dettaglio: l'uid e'
// l'unica cosa stabile di un umano (il colore lo puo' cambiare in lobby fra
// una gara e l'altra), mentre un bot un uid non ce l'ha e il suo colore glielo
// impone la stagione apposta (vedi createBots).
function idPilotaDi(stagione, giocatore) {
    const piloti = stagione.piloti || [];
    if (!giocatore.isBot && giocatore.uid) {
        const p = piloti.find(x => !x.bot && x.uid === giocatore.uid);
        return p ? p.id : null;
    }
    const p = piloti.find(x => x.bot && x.colore === giocatore.color);
    return p ? p.id : null;
}

// L'ordine d'arrivo, tradotto negli id della stagione. Chi non appartiene alla
// stagione viene saltato invece di far fallire tutto: un pilota in piu' in
// pista e' un problema, ma non e' un buon motivo per perdere il risultato di
// tutti gli altri.
function ordineDelPodio(stagione, podium) {
    return (podium || [])
        .map(p => idPilotaDi(stagione, p))
        .filter(Boolean);
}

// L'UNICO punto in cui una stagione viene scritta. Subito dopo la bandiera a
// scacchi, mai a meta' weekend: e' cosi' che "chi chiude il browser perde il
// weekend, non la stagione" diventa vero senza doverlo programmare.
async function registraGara(stagione, podium) {
    const aggiornata = F1Stagione.registraRisultato(stagione, {
        ordine: ordineDelPodio(stagione, podium),
    });
    await seasonStore.salva(aggiornata);
    return aggiornata;
}

module.exports = { impostazioniPerLaProssimaGara, idPilotaDi, ordineDelPodio, registraGara };
```

- [ ] **Step 4: Eseguire i test**

Run: `node --test backend/sockets/games/f1Stagione.server.test.js`
Expected: PASS 6/6.

- [ ] **Step 5: Commit**

```bash
git add backend/sockets/games/f1Stagione.server.js backend/sockets/games/f1Stagione.server.test.js
git commit -m "Stagioni passo 3/2: il ponte fra una gara finita e il campionato"
```

---

### Task 3: *Corri* porta tutti in pista

**Files:**
- Modify: `backend/sockets/games/f1GameSocket.js` (nuovo handler + nascita della partita)
- Modify: `backend/sockets/games/f1GameSocket.stagione.test.js`

**Interfaces:**
- Consumes: `ponte.impostazioniPerLaProssimaGara`, `seasonStore.leggi`
- Produces:
  - in ingresso `f1StagioneCorri { lobbyId }` (solo chi ospita)
  - in uscita `f1StagioneInPista { trackId }` a tutta la lobby → il client ricarica
  - la partita che nasce con `settings.stagioneInCorso` parte da `tyre_select` e porta `game.stagioneId` + `game.botStagione`

- [ ] **Step 1: Scrivere il test che fallisce**

Aggiungi a `backend/sockets/games/f1GameSocket.stagione.test.js`:

```js
test('Corri prepara la pista del calendario e manda tutti in pista', async (t) => {
    t.after(pulisci);
    t.after(() => require('../../store/seasonStore.js')._svuota());
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const io = ioFinto();
    const a = entra(io, 'stagione');

    const F1Stagione = require('../../../frontend/shared/f1Stagione.js');
    const seasonStore = require('../../store/seasonStore.js');
    const stagione = await seasonStore.salva(F1Stagione.creaStagione({
        nome: 'Corsa', creataDa: 'uid-andrea',
        piloti: [{ uid: 'uid-andrea', colore: 'red', bot: false }, { uid: null, colore: '#111111', bot: true, nome: 'Bot 1' }],
        calendario: ['new-monza', 'prova'],
        impostazioni: { botsEnabled: true, gridSize: 2 },
    }));

    a.handlers.f1StagioneScelta({ lobbyId: LOBBY, stagioneId: stagione._id });
    io.inviati.length = 0;
    await a.handlers.f1StagioneCorri({ lobbyId: LOBBY });

    const lobby = lobbies.get(LOBBY);
    assert.equal(lobby.gameSettings.trackId, 'new-monza', 'la pista e quella del calendario');
    assert.equal(lobby.gameSettings.stagioneInCorso, true);
    assert.equal(lobby.gameSettings.stagioneId, stagione._id);
    assert.ok((lobby.sessioneF1 || 0) > 0, 'la sessione va timbrata, o il rientro sembrera un F5');

    const annuncio = io.inviati.find(m => m.evento === 'f1StagioneInPista');
    assert.ok(annuncio, 'i client devono sapere che si va in pista');
    assert.equal(annuncio.dest, LOBBY);
});

test('la partita di una gara di campionato parte dal weekend, non dal calendario', (t) => {
    t.after(pulisci);
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const io = ioFinto();
    lobbies.set(LOBBY, {
        host: 'red', players: ['red'], lockedPlayers: ['red'],
        gameSettings: {
            trackId: 'prova', botsEnabled: 'true', gridSize: '3',
            formato: 'stagione', stagioneId: 'stag-1', stagioneInCorso: true,
        },
    });
    const a = collega(io);
    a.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'red', uid: 'uid-andrea', token: creaGettone(LOBBY, 'red') });

    const g = activeGames.get(LOBBY);
    assert.equal(g.phase, 'tyre_select', 'si sta correndo una gara: il weekend parte come sempre');
    assert.equal(g.stagioneId, 'stag-1', 'ma la partita sa a quale campionato appartiene');
});

test('solo chi ospita puo lanciare la gara', async (t) => {
    t.after(pulisci);
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const io = ioFinto();
    entra(io, 'stagione');
    lobbies.get(LOBBY).players.push('blue');
    lobbies.get(LOBBY).lockedPlayers.push('blue');
    const b = collega(io);
    b.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'blue', uid: 'uid-amico', token: creaGettone(LOBBY, 'blue') });

    io.inviati.length = 0;
    await b.handlers.f1StagioneCorri({ lobbyId: LOBBY });
    assert.equal(io.inviati.filter(m => m.evento === 'f1StagioneInPista').length, 0);
});
```

- [ ] **Step 2: Eseguire e verificare che fallisca**

Run: `node --test backend/sockets/games/f1GameSocket.stagione.test.js`
Expected: FAIL — `a.handlers.f1StagioneCorri is not a function`.

- [ ] **Step 3: Far nascere la partita "gara di campionato"**

In `f1GameSocket.js`, dove oggi si calcola `formatoRichiesto`, aggiungi accanto:

```js
            const impostazioniLobby = (lobby && lobby.gameSettings) || {};
            // Si sta CORRENDO una gara del campionato: la partita e' un
            // weekend normale in tutto, sa solo a quale stagione appartiene.
            // Senza questa distinzione la pagina che riparte dopo "Corri"
            // riaprirebbe il calendario invece della pista.
            const gara = formatoRichiesto === 'stagione' && impostazioniLobby.stagioneInCorso === true;
```

poi cambia la riga della fase:

```js
                phase: (formatoRichiesto === 'stagione' && !gara) ? 'stagione' : 'tyre_select',
```

e aggiungi ai campi della partita:

```js
                stagioneId: impostazioniLobby.stagioneId || null,
                // I bot di QUESTA stagione: colori e nomi fissi, letti dal
                // documento e passati a createBots (vedi Task 1). Popolato
                // sotto, subito prima di createBots.
                botStagione: null,
```

(togliendo il vecchio `stagioneId: null,`)

Subito prima di `createBots(activeGames.get(lobbyId), lobby, TYRE_COMPOUNDS);`:

```js
            // I bot della stagione, se questa e' una gara di campionato. La
            // lettura e' asincrona e createBots e' sincrona: si legge PRIMA
            // di creare la partita? No — si e' scelto di tenere la lista
            // dentro le impostazioni, che il server ha gia' in mano, proprio
            // per non dover aspettare Mongo nel mezzo di un join.
            if (gara && Array.isArray(impostazioniLobby.botStagione)) {
                activeGames.get(lobbyId).botStagione = impostazioniLobby.botStagione;
            }
```

- [ ] **Step 4: Scrivere l'handler**

Accanto a `f1StagioneScelta`:

```js
    // Dal calendario alla pista. Fa esattamente quello che fa startGame dalla
    // lobby — scrive le impostazioni e timbra la sessione — e poi dice ai
    // client di ricaricare: da li' in poi gira il weekend di sempre, sulla
    // pista del calendario, senza una riga di codice diversa. E' la ragione
    // per cui il codice del weekend non va toccato (Rif. spec, "Il punto").
    socket.on('f1StagioneCorri', async ({ lobbyId }) => {
        const game = activeGames.get(lobbyId);
        if (!game || game.gameId !== 'f1') return;
        if (socket.color !== game.hostColor) return;
        if (!game.stagioneId) return;

        const stagione = await seasonStore.leggi(game.stagioneId);
        if (!stagione) return;
        const lobby = lobbies.get(lobbyId);
        if (!lobby) return;

        const settings = Stagione.impostazioniPerLaProssimaGara(stagione, lobby.gameSettings);
        if (!settings) return;   // stagione finita: non c'e' niente da correre

        lobby.gameSettings = settings;
        lobby.lockedPlayers = [...lobby.players];
        // Stesso timbro di startGame: senza, joinF1Game scambierebbe il
        // rientro per un F5 e riuserebbe la partita del calendario.
        lobby.sessioneF1 = (lobby.sessioneF1 || 0) + 1;

        io.to(lobbyId).emit('f1StagioneInPista', { trackId: settings.trackId });
    });
```

con, in cima al file, `const Stagione = require('./f1Stagione.server.js');`.

- [ ] **Step 5: Eseguire i test**

Run: `node --test backend/sockets/games/f1GameSocket.stagione.test.js` → PASS
Run: `node --test backend/` → nessun rosso nuovo.

- [ ] **Step 6: Commit**

```bash
git add backend/sockets/games/f1GameSocket.js backend/sockets/games/f1GameSocket.stagione.test.js backend/sockets/games/f1Stagione.server.js backend/sockets/games/f1Stagione.server.test.js
git commit -m "Stagioni passo 3/3: Corri porta tutti sulla pista del calendario"
```

---

### Task 4: Il risultato torna nel campionato

**Files:**
- Modify: `backend/sockets/games/f1GameSocket.js` (`endRace`)
- Modify: `backend/sockets/games/f1Stagione.server.test.js`

**Interfaces:**
- Consumes: `ponte.registraGara`
- Produces: dopo `f1RaceEnded`, se la partita appartiene a una stagione, il server registra il risultato e poi emette `f1StagioneAlCalendario { stagioneId }` a tutta la lobby.

- [ ] **Step 1: Scrivere il test che fallisce**

Aggiungi a `backend/sockets/games/f1GameSocket.stagione.test.js`:

```js
test('finita una gara di campionato il risultato viene registrato e si torna al calendario', async (t) => {
    t.after(pulisci);
    const seasonStore = require('../../store/seasonStore.js');
    t.after(() => seasonStore._svuota());
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const io = ioFinto();
    const F1Stagione = require('../../../frontend/shared/f1Stagione.js');

    const stagione = await seasonStore.salva(F1Stagione.creaStagione({
        nome: 'Con risultato', creataDa: 'uid-andrea',
        piloti: [{ uid: 'uid-andrea', colore: 'red', bot: false }],
        calendario: ['prova', 'new-monza', 'monte-rosso'],
        impostazioni: { botsEnabled: false, gridSize: 1 },
    }));

    lobbies.set(LOBBY, {
        host: 'red', players: ['red'], lockedPlayers: ['red'],
        gameSettings: {
            trackId: 'prova', botsEnabled: 'false', gridSize: '1',
            formato: 'stagione', stagioneId: stagione._id, stagioneInCorso: true,
        },
    });
    const a = collega(io);
    a.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'red', uid: 'uid-andrea', token: creaGettone(LOBBY, 'red') });

    const g = activeGames.get(LOBBY);
    g.phase = 'race';
    g.grid = ['red'];
    for (const p of Object.values(g.players)) { p.finished = true; p.time = 60000; p.lap = g.track.totalLaps; }

    io.inviati.length = 0;
    await registraHandlerF1.endRace(io, LOBBY, g);

    const riletta = await seasonStore.leggi(stagione._id);
    assert.equal(riletta.giro, 1, 'il calendario deve essere avanzato');
    assert.equal(riletta.risultati.length, 1);
    assert.deepEqual(riletta.risultati[0].ordine, ['p1']);

    assert.ok(io.inviati.some(m => m.evento === 'f1StagioneAlCalendario'),
        'e i client devono sapere che si torna al calendario');

    // Senza questo la pagina che riparte ricomincerebbe il weekend appena
    // corso invece di tornare al calendario.
    assert.equal(lobbies.get(LOBBY).gameSettings.stagioneInCorso, false);
});

test('una gara VELOCE non tocca nessuna stagione', async (t) => {
    t.after(pulisci);
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const io = ioFinto();
    const a = entra(io, 'veloce');
    const g = activeGames.get(LOBBY);
    g.phase = 'race';
    g.grid = ['red'];
    for (const p of Object.values(g.players)) { p.finished = true; p.time = 60000; p.lap = g.track.totalLaps; }

    io.inviati.length = 0;
    await registraHandlerF1.endRace(io, LOBBY, g);
    assert.equal(io.inviati.filter(m => m.evento === 'f1StagioneAlCalendario').length, 0);
});
```

- [ ] **Step 2: Eseguire e verificare che fallisca**

Run: `node --test backend/sockets/games/f1GameSocket.stagione.test.js`
Expected: FAIL — la stagione resta al giro 0.

- [ ] **Step 3: Implementare**

`endRace` diventa `async` (i suoi chiamanti la invocano senza `await`: va bene, ma il test la aspetta). In fondo, dopo l'`emit` di `f1RaceEnded` e prima del blocco `if (isFinal)`:

```js
    // GARA DI CAMPIONATO: il risultato entra nella stagione. E' l'unico punto
    // in cui una stagione viene scritta, ed e' subito dopo la bandiera a
    // scacchi — mai a meta' weekend. E' cosi' che "chi chiude il browser perde
    // il weekend, non la stagione" e' vero senza doverlo programmare: non
    // esiste nessun altro momento in cui si sarebbe potuto salvare.
    if (game.stagioneId) {
        // La pagina che ripartira' deve tornare al CALENDARIO, non
        // ricominciare il weekend: si toglie il flag e si timbra la sessione,
        // le stesse due mosse di "Corri" al contrario. Fatto prima del
        // salvataggio, perche' vale anche se il salvataggio fallisce — restare
        // in un weekend gia' corso sarebbe il guaio peggiore.
        const lobby = lobbies.get(lobbyId);
        if (lobby && lobby.gameSettings) {
            lobby.gameSettings.stagioneInCorso = false;
            lobby.sessioneF1 = (lobby.sessioneF1 || 0) + 1;
        }
        try {
            const stagione = await seasonStore.leggi(game.stagioneId);
            if (stagione && !F1Stagione.finita(stagione)) {
                await Stagione.registraGara(stagione, podium);
            }
            // I client tornano al calendario, che ora ha una gara in piu' in
            // classifica. Anche se il salvataggio e' fallito: restare piantati
            // sul podio sarebbe peggio, e la gara si potra' rigiocare.
            io.to(lobbyId).emit('f1StagioneAlCalendario', { stagioneId: game.stagioneId });
        } catch (err) {
            console.error(`[F1] risultato di campionato non salvato (lobby ${lobbyId}):`, err);
            io.to(lobbyId).emit('f1StagioneAlCalendario', { stagioneId: game.stagioneId, errore: true });
        }
    }
```

Serve `const F1Stagione = require('../../../frontend/shared/f1Stagione.js');` in cima al file, se non c'è già.

- [ ] **Step 4: Eseguire i test**

Run: `node --test backend/sockets/games/` → nessun rosso nuovo (attenzione ai test esistenti che chiamano `endRace`: ora restituisce una Promise, ma nessuno di loro ne usa il valore).

- [ ] **Step 5: Commit**

```bash
git add backend/sockets/games/f1GameSocket.js backend/sockets/games/f1GameSocket.stagione.test.js
git commit -m "Stagioni passo 3/4: a fine gara il risultato entra nel campionato"
```

---

### Task 5: Il client — *Corri* si accende, e a fine gara si torna al calendario

**Files:**
- Modify: `frontend/shared/f1StagioneSchermate.js`
- Modify: `frontend/f1.js`
- Modify: `frontend/f1.html` (bump `?v=`)

- [ ] **Step 1: Accendere *Corri***

In `f1StagioneSchermate.js`, dentro `mostraStagione`, al posto di:

```js
            el('stagione-corri').disabled = true;
```

metti:

```js
            // Si corre se: la stagione non e' finita, la si puo' riprendere con
            // i giocatori che ci sono adesso, e sei tu a ospitare. Le tre
            // condizioni le decide il server comunque — qui servono solo a non
            // offrire un pulsante che poi non fa niente.
            const puoiCorrere = !finita && (!ripresa || ripresa.ok) && puoScegliere;
            el('stagione-corri').disabled = !puoiCorrere;
            el('stagione-corri').style.display = puoScegliere ? '' : 'none';
```

e aggancia:

```js
        el('stagione-corri').addEventListener('click', () => {
            el('stagione-corri').disabled = true;   // un solo via, anche se si preme due volte
            socket.emit('f1StagioneCorri', { lobbyId });
        });
```

Aggiorna anche la nota: al posto di `'Correre una gara arriva col prossimo passo.'` metti `''` quando si può correre, e tieni il messaggio della guardia quando non si può.

- [ ] **Step 2: Il reload comandato dal server**

In `frontend/f1.js`, accanto agli altri handler socket:

```js
    // Il campionato manda in pista: la pagina riparte con la pista della gara
    // del calendario. Ricaricare invece di ricostruire la scena e' la scelta
    // che tiene INTATTO il codice del weekend — vedi il piano del passo 3.
    socket.on('f1StagioneInPista', () => { window.location.reload(); });

    // Gara di campionato finita: si torna al calendario, che e' la stessa
    // pagina senza stagioneInCorso. Il ritardo lascia vedere il podio, che e'
    // il premio della gara appena corsa.
    socket.on('f1StagioneAlCalendario', () => {
        setTimeout(() => { window.location.reload(); }, 8000);
    });
```

> Il reload rilegge `GET /api/lobby/:id/settings`, dove il Task 4 ha già tolto `stagioneInCorso`: è quello che fa tornare al calendario invece di ricominciare il weekend appena corso.

- [ ] **Step 3: Riaprire il calendario sulla stagione giusta**

Al rientro, `f1Setup` porta `stagioneId`: il codice del passo 2b già emette `f1StagioneScelta` in quel caso, quindi la schermata si apre sul calendario aggiornato. Verificare che sia ancora vero dopo le modifiche.

- [ ] **Step 4: Bump e prova manuale**

Alza `f1.js?v=` e `f1StagioneSchermate.js?v=` in `frontend/f1.html`.

- [ ] **Step 5: Commit**

```bash
git add frontend/shared/f1StagioneSchermate.js frontend/f1.js frontend/f1.html
git commit -m "Stagioni passo 3/5: Corri lancia il weekend, e il podio riporta al calendario"
```

---

### Task 6: Il playtest della spec

- [ ] **Step 1: Suite intera**

Run: `node --test backend/` — nessun rosso oltre ai 5 preesistenti.

- [ ] **Step 2: Le tre prove chieste dalla spec**

1. **Due gare di fila.** Crea una stagione da 3 gare, premi *Corri*, corri il weekend fino al podio: si deve tornare al calendario con la prima gara segnata e i punti in classifica. Premi *Corri* di nuovo: dev'essere la **seconda** pista del calendario, e i bot devono essere gli stessi (stessi colori).
2. **Una gara chiusa a metà non conta.** Durante la seconda gara, torna in lobby prima della bandiera a scacchi. Rientra nella stagione: il calendario deve essere ancora fermo alla seconda gara, e la classifica deve avere solo la prima.
3. **La gara veloce non è cambiata.** F1 → *Quick Race* → weekend normale, podio, «Riavvia».

- [ ] **Step 3: Riferire e fermarsi**

Restano il passo 4 (la classifica fra una gara e l'altra, che è già a schermo ma va rifinita) e il passo 5 (fine stagione e premiazione del campione), su cui la spec dice esplicitamente di chiedere consiglio all'utente quando si arriva lì.
