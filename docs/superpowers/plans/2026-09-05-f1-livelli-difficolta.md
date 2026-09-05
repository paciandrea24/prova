# I livelli di difficoltà dei bot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Il giocatore sceglie in lobby fra Facile, Medio e Difficile, e quella scelta decide ritmo, precisione e aggressività di tutti i bot della gara — al posto dei due numeri che oggi ogni bot pesca a caso da solo.

**Architecture:** Un modulo nuovo (`f1Difficolta.js`) tiene la tabella dei tre livelli e risponde a una sola domanda: «dato un livello, che intervalli di ritmo e rumore, e che soglie di aggressività?». `createBots` gli chiede gli intervalli invece di leggere le costanti, e `updateBotInputs` gli chiede le soglie invece di usare le costanti fisse. La lobby aggiunge un `<select>`; la stagione salva il livello fra le sue impostazioni e lo rimanda indietro a ogni gara.

**Tech Stack:** Node.js, `node --test` + `node:assert/strict`; modulo UMD condiviso in `frontend/shared/` (lo legge il server, come `f1Stagione.js`); HTML/JS vanilla per la lobby.

**Spec:** `docs/superpowers/specs/2026-09-05-f1-livelli-difficolta-design.md`

## Global Constraints

- **Italiano** nei commenti del codice e nei messaggi di commit.
- **I tre livelli e i loro intervalli**, copiati dalla spec e da non cambiare senza rimisurare:
  | livello | ritmo | rumore |
  |---|---|---|
  | `facile` | 0.905 – 0.925 | 0.16 – 0.22 |
  | `medio` | 0.945 – 0.965 | 0.08 – 0.14 |
  | `difficile` | 0.985 – 1.000 | 0.00 – 0.06 |
- **Un livello assente o sconosciuto vale `medio`.** Mai un bot senza ritmo.
- **Gli intervalli restano intervalli**: dentro un livello i bot devono restare diversi fra loro, o la griglia gira in fila indiana (richiesta esplicita dell'utente, già scritta nei commenti di `f1Bot.js:568-578`).
- **Non si tocca il modello di guida**: `cornerTargetSpeed`, il pure-pursuit, le traiettorie, e il rumore ridotto in avvicinamento ai box (`BOT_PIT_APPROACH_NOISE_SCALE`).
- **Baseline dei test, da rimisurare prima di cominciare**: `node --test backend/` → 921 test, **10 rossi + 2 skip**. I rossi noti sono `nuova-pista: i bot entrano davvero in corsia box`, `Simcade: isolamento dei componenti`, i due `loadTrack("monte-rosso")`, `gettoneNavigazione.test.js`, `identitaLobby.test.js`, e quattro `simulateLap`.

## Struttura dei file

| File | Responsabilità |
|---|---|
| `frontend/shared/f1Difficolta.js` (nuovo) | La tabella dei livelli e le due domande: intervalli per `createBots`, soglie per `updateBotInputs` |
| `frontend/shared/f1Difficolta.test.js` (nuovo) | Che i livelli siano ordinati, che l'ignoto valga medio, che gli intervalli non degenerino |
| `backend/sockets/games/f1Bot.js` | `createBots` pesca dentro gli intervalli del livello; `updateBotInputs` legge le soglie dal livello |
| `backend/sockets/games/f1Bot.test.js` | Che la griglia rispetti il livello e resti varia dentro di esso |
| `frontend/lobby.html:149` | Il `<select>` del livello, accanto a Drivers |
| `frontend/lobby.js:27` | Il valore di partenza (`medio`) fra le impostazioni F1 |
| `backend/routes/f1Stagioni.js:130` | Il livello entra fra le impostazioni della stagione |
| `backend/sockets/games/f1Stagione.server.js:20-30` | Il livello torna indietro a ogni gara del campionato |
| `backend/sockets/games/f1Stagione.server.test.js` | Che una stagione conservi il suo livello |

⚠️ **Perché il modulo sta in `frontend/shared/`** e non in `backend/`: lo legge il server (`f1Bot.js`) ma anche la lobby potrebbe volerne i nomi per l'interfaccia, ed è lo stesso posto dove vive `f1Stagione.js`, che ha esattamente questa doppia vita. Segue lo schema UMD degli altri moduli condivisi.

---

### Task 1: Il modulo dei livelli

**Files:**
- Create: `frontend/shared/f1Difficolta.js`
- Test: `frontend/shared/f1Difficolta.test.js`

**Interfaces:**
- Produces:
  - `F1Difficolta.LIVELLI` → array `['facile', 'medio', 'difficile']`, dal più lento al più veloce;
  - `F1Difficolta.PREDEFINITO` → `'medio'`;
  - `F1Difficolta.normalizza(valore)` → uno dei tre livelli, `'medio'` per tutto il resto;
  - `F1Difficolta.intervalliDi(livello)` → `{ ritmoMin, ritmoMax, rumoreMin, rumoreMax }`;
  - `F1Difficolta.soglieDi(livello)` → `{ margineSorpasso, frazioneMinimaInScia }`.

- [ ] **Step 1: Scrivere i test che falliscono**

Creare `frontend/shared/f1Difficolta.test.js`:

```js
// frontend/shared/f1Difficolta.test.js
//
// I tre livelli di difficolta' dei bot (spec 2026-09-05). La tabella e'
// tarata su misure fatte col banco prova, non a sensazione: i numeri stanno
// nella spec e qui si controlla che restino coerenti fra loro.
const test = require('node:test');
const assert = require('node:assert/strict');
const F1Difficolta = require('./f1Difficolta.js');

test('i tre livelli, dal piu\' lento al piu\' veloce', () => {
    assert.deepEqual(F1Difficolta.LIVELLI, ['facile', 'medio', 'difficile']);
    assert.equal(F1Difficolta.PREDEFINITO, 'medio');
});

test('un livello sconosciuto, assente o storto vale medio', () => {
    // ⚠️ Una lobby aperta prima di questa modifica non manda niente, e un
    // client vecchio puo' mandare qualunque cosa: nessuno dei due deve
    // ritrovarsi bot senza ritmo.
    for (const strano of [undefined, null, '', 'MEDIO', 'impossibile', 42, {}]) {
        assert.equal(F1Difficolta.normalizza(strano), 'medio', `con ${JSON.stringify(strano)}`);
    }
    assert.equal(F1Difficolta.normalizza('facile'), 'facile');
});

test('salendo di livello i bot vanno piu\' forte e sbagliano meno', () => {
    const f = F1Difficolta.intervalliDi('facile');
    const m = F1Difficolta.intervalliDi('medio');
    const d = F1Difficolta.intervalliDi('difficile');
    // Il ritmo sale...
    assert.ok(f.ritmoMax <= m.ritmoMin, 'facile e medio si sovrappongono nel ritmo');
    assert.ok(m.ritmoMax <= d.ritmoMin, 'medio e difficile si sovrappongono nel ritmo');
    // ...e il rumore scende, insieme. Le due leve non si muovono mai in
    // direzioni opposte: un bot veloce e impreciso esce di pista (misurato:
    // ritmo 1.00 con rumore 0.25 fa 13 tick fuori dal cordolo).
    assert.ok(d.rumoreMax <= m.rumoreMin, 'medio e difficile si sovrappongono nel rumore');
    assert.ok(m.rumoreMax <= f.rumoreMin, 'facile e medio si sovrappongono nel rumore');
});

test('ogni livello e\' un intervallo vero, non un numero solo', () => {
    // ⚠️ La varianza dentro il livello e' cio' che rompe l'ordine statico
    // della griglia: senza, chi parte davanti resta davanti e non si vede un
    // sorpasso per tutta la gara (f1Bot.js:568-578).
    for (const livello of F1Difficolta.LIVELLI) {
        const i = F1Difficolta.intervalliDi(livello);
        assert.ok(i.ritmoMax > i.ritmoMin, `${livello}: il ritmo e' un punto solo`);
        assert.ok(i.rumoreMax > i.rumoreMin, `${livello}: il rumore e' un punto solo`);
        assert.ok(i.ritmoMin > 0.5 && i.ritmoMax <= 1, `${livello}: ritmo fuori scala`);
        assert.ok(i.rumoreMin >= 0, `${livello}: rumore negativo`);
    }
});

test('l\'aggressivita\' cresce col livello', () => {
    const f = F1Difficolta.soglieDi('facile');
    const d = F1Difficolta.soglieDi('difficile');
    // Meno margine richiesto = tenta il sorpasso piu' spesso.
    assert.ok(d.margineSorpasso < f.margineSorpasso, 'a difficile deve attaccare con meno margine');
    // Frazione piu' alta = resta piu' attaccato a chi precede.
    assert.ok(d.frazioneMinimaInScia > f.frazioneMinimaInScia, 'a difficile deve talonare di piu\'');
});

test('i valori di oggi restano dentro il livello medio', () => {
    // ⚠️ E' il collaudo del default: chi non sceglie niente deve trovare
    // avversari simili a quelli di prima di questa modifica, non un gioco
    // diverso. I numeri storici sono BOT_OVERTAKE_PACE_MARGIN 1.01 e
    // BOT_FOLLOW_MIN_FRACTION 0.85.
    const m = F1Difficolta.soglieDi('medio');
    assert.ok(Math.abs(m.margineSorpasso - 1.01) < 0.02);
    assert.ok(Math.abs(m.frazioneMinimaInScia - 0.85) < 0.05);
});
```

- [ ] **Step 2: Eseguire i test e vederli fallire**

Run: `node --test frontend/shared/f1Difficolta.test.js`
Expected: FAIL, `Cannot find module './f1Difficolta.js'`.

- [ ] **Step 3: Scrivere il modulo**

Creare `frontend/shared/f1Difficolta.js`:

```js
// frontend/shared/f1Difficolta.js
//
// I tre livelli di difficolta' dei bot: cosa vuol dire, in numeri, che una
// gara e' facile o difficile.
//
// ⚠️ LA DIFFICOLTA' ESISTEVA GIA', MA GIRAVA A CASO. Prima del 2026-09-05
// ogni bot pescava da solo il proprio ritmo (0.93-1.00) e il proprio rumore
// di sterzo (0-0.25) alla creazione della griglia: il giocatore incontrava
// avversari fra +1.9 e +5.6 secondi al giro senza che nessuno lo decidesse.
// Qui quei due intervalli diventano tre coppie, scelte dal giocatore.
//
// I numeri sono tarati su misure col banco prova (`prova`, giro umano di
// riferimento 47.30 s, tre giri per casella). Rif.
// docs/superpowers/specs/2026-09-05-f1-livelli-difficolta-design.md.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.F1Difficolta = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    const PREDEFINITO = 'medio';
    const LIVELLI = ['facile', 'medio', 'difficile'];

    // ⚠️ RITMO E RUMORE SI MUOVONO INSIEME, mai in direzioni opposte: un bot
    // veloce e impreciso esce di pista. Misurato su `prova`: ritmo 1.00 con
    // rumore 0.25 fa 13 tick fuori dal cordolo, lo stesso rumore a ritmo 0.97
    // ne fa 3.
    //
    // Restano INTERVALLI e non valori fissi perche' la varianza fra i bot e'
    // cio' che rompe l'ordine statico della griglia: senza, chi parte davanti
    // resta davanti per tutta la gara.
    const TABELLA = {
        // dove cade su `prova`, rispetto al giro umano di 47.30 s:
        facile:    { ritmoMin: 0.905, ritmoMax: 0.925, rumoreMin: 0.16, rumoreMax: 0.22,  // +5.02 / +5.80 s
                     margineSorpasso: 1.04, frazioneMinimaInScia: 0.75 },
        medio:     { ritmoMin: 0.945, ritmoMax: 0.965, rumoreMin: 0.08, rumoreMax: 0.14,  // +3.67 / +4.38 s
                     margineSorpasso: 1.01, frazioneMinimaInScia: 0.85 },
        difficile: { ritmoMin: 0.985, ritmoMax: 1.000, rumoreMin: 0.00, rumoreMax: 0.06,  // +1.85 / +3.23 s
                     margineSorpasso: 1.00, frazioneMinimaInScia: 0.92 },
    };

    // ⚠️ Tutto cio' che non e' esattamente uno dei tre livelli vale `medio`:
    // una lobby aperta prima di questa modifica non manda niente, e un client
    // vecchio puo' mandare qualunque cosa. Nessuno dei due deve ritrovarsi
    // bot senza ritmo — un `botSpeedFactor` undefined moltiplica la velocita'
    // obiettivo per NaN e l'auto sparisce dal tracciato.
    function normalizza(valore) {
        return LIVELLI.indexOf(valore) >= 0 ? valore : PREDEFINITO;
    }

    function intervalliDi(livello) {
        const t = TABELLA[normalizza(livello)];
        return { ritmoMin: t.ritmoMin, ritmoMax: t.ritmoMax,
                 rumoreMin: t.rumoreMin, rumoreMax: t.rumoreMax };
    }

    // Le due soglie che governano l'aggressivita', gia' esistenti in f1Bot.js
    // come costanti: quanto margine di velocita' serve per tentare un sorpasso
    // e quanto ci si accoda a chi precede. I valori di `medio` sono quelli
    // storici (1.01 e 0.85), cosi' chi non sceglie niente ritrova la gara di
    // prima.
    function soglieDi(livello) {
        const t = TABELLA[normalizza(livello)];
        return { margineSorpasso: t.margineSorpasso,
                 frazioneMinimaInScia: t.frazioneMinimaInScia };
    }

    return { LIVELLI, PREDEFINITO, normalizza, intervalliDi, soglieDi };
});
```

- [ ] **Step 4: Eseguire i test e vederli passare**

Run: `node --test frontend/shared/f1Difficolta.test.js`
Expected: PASS, tutti e sei.

- [ ] **Step 5: Commit**

```bash
git add frontend/shared/f1Difficolta.js frontend/shared/f1Difficolta.test.js
git commit
```
Messaggio: `Tre livelli di difficolta', in numeri misurati`

---

### Task 2: La griglia nasce col livello scelto

**Files:**
- Modify: `backend/sockets/games/f1Bot.js` — `createBots` (righe ~617-700)
- Test: `backend/sockets/games/f1Bot.test.js`

**Interfaces:**
- Consumes: `F1Difficolta.intervalliDi` dal Task 1.
- Produces: nessuna firma nuova; `createBots` legge `game.settings.botDifficolta`.

- [ ] **Step 1: Scrivere i test che falliscono**

In `backend/sockets/games/f1Bot.test.js`, in fondo:

```js
// ═══════════ I LIVELLI DI DIFFICOLTA' (spec 2026-09-05) ═══════════
const F1Difficolta = require('../../../frontend/shared/f1Difficolta.js');

// ⚠️ NON costruire un finto nuovo: il file ha gia' `partitaPerBot(gridSize)`
// (riga 953) e `TYRE_COMPOUNDS_FINTE`, usati dagli altri test di createBots.
// Serve solo aggiungerci il livello.
function partitaConLivello(livello, quanti) {
    const g = partitaPerBot(quanti);
    if (livello !== undefined) g.settings = { botDifficolta: livello };
    return g;
}

test('a difficile i bot nascono piu\' veloci e piu\' precisi che a facile', () => {
    const facile = partitaConLivello('facile', 8);
    const difficile = partitaConLivello('difficile', 8);
    creaBot(facile, { lockedPlayers: ['red'] }, TYRE_COMPOUNDS_FINTE);
    creaBot(difficile, { lockedPlayers: ['red'] }, TYRE_COMPOUNDS_FINTE);
    const ritmi = (g) => Object.values(g.players).map(p => p.botSpeedFactor);
    const rumori = (g) => Object.values(g.players).map(p => p.botPrecisionNoise);
    assert.ok(Math.min(...ritmi(difficile)) >= Math.max(...ritmi(facile)),
        'il piu\' lento a difficile deve battere il piu\' veloce a facile');
    assert.ok(Math.max(...rumori(difficile)) <= Math.min(...rumori(facile)),
        'il piu\' impreciso a difficile deve battere il piu\' preciso a facile');
});

test('dentro un livello i bot restano diversi fra loro', () => {
    // ⚠️ Senza varianza la griglia gira in fila indiana e non si vede un
    // sorpasso per tutta la gara (f1Bot.js:568-578).
    for (const livello of F1Difficolta.LIVELLI) {
        const g = partitaConLivello(livello, 10);
        creaBot(g, { lockedPlayers: ['red'] }, TYRE_COMPOUNDS_FINTE);
        const ritmi = Object.values(g.players).map(p => p.botSpeedFactor);
        assert.ok(Math.max(...ritmi) - Math.min(...ritmi) > 0.005,
            `${livello}: tutti i bot hanno lo stesso ritmo`);
    }
});

test('ogni bot nasce dentro gli intervalli del suo livello', () => {
    for (const livello of F1Difficolta.LIVELLI) {
        const i = F1Difficolta.intervalliDi(livello);
        const g = partitaConLivello(livello, 10);
        creaBot(g, { lockedPlayers: ['red'] }, TYRE_COMPOUNDS_FINTE);
        for (const p of Object.values(g.players)) {
            assert.ok(p.botSpeedFactor >= i.ritmoMin && p.botSpeedFactor <= i.ritmoMax,
                `${livello}: ritmo ${p.botSpeedFactor} fuori da [${i.ritmoMin}, ${i.ritmoMax}]`);
            assert.ok(p.botPrecisionNoise >= i.rumoreMin && p.botPrecisionNoise <= i.rumoreMax,
                `${livello}: rumore ${p.botPrecisionNoise} fuori da [${i.rumoreMin}, ${i.rumoreMax}]`);
        }
    }
});

test('senza livello scelto la griglia nasce media, e mai senza ritmo', () => {
    const g = partitaConLivello(undefined, 6);
    creaBot(g, { lockedPlayers: ['red'] }, TYRE_COMPOUNDS_FINTE);
    const i = F1Difficolta.intervalliDi('medio');
    for (const p of Object.values(g.players)) {
        assert.ok(Number.isFinite(p.botSpeedFactor) && p.botSpeedFactor > 0,
            'un bot senza ritmo moltiplica la velocita\' per NaN e sparisce dal tracciato');
        assert.ok(p.botSpeedFactor >= i.ritmoMin && p.botSpeedFactor <= i.ritmoMax);
    }
});
```

⚠️ Prima di scrivere questi test, leggere la firma vera di `createBots(game, lobby, TYRE_COMPOUNDS, rng)` e come costruisce i colori: se `lobby` a `null` non basta, passare l'oggetto minimo che serve invece di inventare un finto diverso.

- [ ] **Step 2: Eseguire i test e vederli fallire**

Run: `node --test backend/sockets/games/f1Bot.test.js`
Expected: FAIL, i bot nascono con gli intervalli storici (0.93-1.00 e 0-0.25) e i livelli non li spostano.

- [ ] **Step 3: Far pescare createBots dentro il livello**

In `backend/sockets/games/f1Bot.js`, in cima al file accanto agli altri require:

```js
const F1Difficolta = require('../../../frontend/shared/f1Difficolta.js');
```

Dentro `createBots`, subito dopo la riga `const botsEnabled = ...`:

```js
    // Il livello scelto in lobby decide ritmo e precisione di TUTTA la
    // griglia. Prima del 2026-09-05 ogni bot pescava per conto suo fra
    // 0.93-1.00 e 0-0.25, quindi la difficolta' cambiava da una gara
    // all'altra senza che nessuno la scegliesse.
    const intervalli = F1Difficolta.intervalliDi(game.settings && game.settings.botDifficolta);
```

E dove oggi si assegnano i due campi (righe ~680-681):

```js
            botSpeedFactor:         randRange(intervalli.ritmoMin, intervalli.ritmoMax, rng),
            botPrecisionNoise:      randRange(intervalli.rumoreMin, intervalli.rumoreMax, rng),
```

Le costanti `BOT_SPEED_FACTOR_MIN/MAX` e `BOT_PRECISION_NOISE_MIN/MAX` restano dove sono **solo se qualcun altro le usa**: cercarle con `grep -n "BOT_SPEED_FACTOR_\|BOT_PRECISION_NOISE_" backend/` e, se l'unico uso era questo, toglierle — una costante che non decide più niente ma resta scritta fa credere al prossimo lettore che sia lei a comandare. ⚠️ `BOT_PRECISION_NOISE_MAX` è usata anche per normalizzare il rumore in avvicinamento ai box: quella riga non va toccata.

- [ ] **Step 4: Eseguire i test e vederli passare**

Run: `node --test backend/sockets/games/f1Bot.test.js` → PASS
Poi `node --test backend/` per intero: **gli stessi 10 rossi della baseline.**

- [ ] **Step 5: Misurare i tre livelli sul banco prova**

I test dicono che i numeri sono quelli scritti; questa misura dice che in pista significano qualcosa. Un bot per livello, su `prova`:

```bash
node -e "
const TG=require('./frontend/shared/trackGeometry.js');
const {loadTrack}=require('./backend/sockets/games/trackLoader.js');
const {simulateLap}=require('./backend/tools/f1LapSimulator.js');
const D=require('./frontend/shared/f1Difficolta.js');
const t=loadTrack('prova');
for(const liv of D.LIVELLI){
  const i=D.intervalliDi(liv);
  for(const [dove,sf,ru] of [['il piu\' lento',i.ritmoMin,i.rumoreMax],['il piu\' veloce',i.ritmoMax,i.rumoreMin]]){
    const tempi=[],usciteMedie=[];
    for(let s=0;s<3;s++){
      const r=simulateLap(t,{speedFactor:sf,paceMult:1,precisionNoise:ru,safetyCapS:90});
      if(!r.finished) continue;
      tempi.push(r.timeMs);
      // ⚠️ Le uscite si contano SEMPRE, non solo i tempi: un livello
      // veloce che manda i bot fuori pista non e' piu' difficile, e'
      // rotto. Il riferimento e' il bot medio di oggi su `prova`:
      // 8 tick a rumore 0.16, 13 a rumore 0.25.
      let f=0;
      for(const c of r.telemetry) if(TG.nearestPoint(t.points,c.x,c.z).dist>t.roadHalf+2.8) f++;
      usciteMedie.push(f);
    }
    const m=Math.round(tempi.reduce((a,b)=>a+b,0)/tempi.length);
    const fuori=Math.round(usciteMedie.reduce((a,b)=>a+b,0)/usciteMedie.length);
    console.log(liv.padEnd(10)+dove.padEnd(16)+m+'ms   +'+((m-47300)/1000).toFixed(2)+'s dal giro umano   '+fuori+' tick fuori dal cordolo');
  }
}"
```

Atteso, dalla spec: difficile fra +1.85 e +3.23 s, medio fra +3.67 e +4.38, facile fra +5.02 e +5.80 — misurati mentre si scriveva il piano. **E nessun livello deve superare le uscite del bot medio di oggi: 8 tick a rumore 0.16, 13 a 0.25; con questa taratura sono usciti 0-1** (invariante 3 della spec). **Riportare i numeri.** Se un livello cade fuori di più di mezzo secondo, dirlo prima di andare avanti: vuol dire che la tabella va ritarata, e la taratura è una decisione dell'utente.

- [ ] **Step 6: Commit**

```bash
git add backend/sockets/games/f1Bot.js backend/sockets/games/f1Bot.test.js
git commit
```
Messaggio: `La griglia nasce col livello scelto, non a caso`

---

### Task 3: L'aggressività scala col livello

**Files:**
- Modify: `backend/sockets/games/f1Bot.js` — `updateBotInputs`, i due punti che usano `BOT_OVERTAKE_PACE_MARGIN` (riga ~1296) e `BOT_FOLLOW_MIN_FRACTION` (riga ~1306)
- Test: `backend/sockets/games/f1Bot.test.js`

**Interfaces:**
- Consumes: `F1Difficolta.soglieDi` dal Task 1.

- [ ] **Step 1: Scrivere il test che fallisce**

```js
test('a difficile un bot tenta il sorpasso dove a facile si accoda', () => {
    // ⚠️ Si misura il COMPORTAMENTO, non la costante: due bot identici, stessa
    // pista, stesso avversario davanti, e si guarda lo stato in cui finiscono.
    // Un test sulla costante direbbe solo che la tabella e' stata letta.
    // Si riusano gli helper che il file ha gia': `makeGripAwarenessGame` (riga
    // 652) costruisce pista + bot, `makeGripAwarenessDeps` (riga 672) le deps
    // di updateBotInputs. Qui serve un secondo bot davanti al primo.
    function statoDi(livello) {
        const { game, p } = makeGripAwarenessGame(0, 'race');
        game.settings = { botDifficolta: livello };
        // L'avversario: stessa pista, quattro campioni davanti e piu' lento.
        const davanti = Object.assign({}, p, {
            trackIndex: p.trackIndex + 4, speed: p.speed * 0.93,
            x: game.track.points[p.trackIndex + 4].x,
            z: game.track.points[p.trackIndex + 4].z,
            inputs: { throttle: 0, brake: 0, steer: 0 },
        });
        game.players = { bot1: p, bot2: davanti };
        updateBotInputs(game, makeGripAwarenessDeps());
        return p._botDebug.state;
    }
    assert.equal(statoDi('difficile'), 'OVERTAKING');
    assert.equal(statoDi('facile'), 'FOLLOWING');
});
```

⚠️ Il divario di velocità del test (7%) è una stima: se non producesse i due stati attesi, **non spostare le soglie della tabella per far passare il test**. Misurare prima quale margine serve davvero — un `console.log` temporaneo di `targetSpeed` e `leaderTargetSpeed` dentro il ramo del sorpasso — e scegliere un divario che cada fra le due soglie (1.00 e 1.04).

- [ ] **Step 2: Eseguire il test e vederlo fallire**

Run: `node --test backend/sockets/games/f1Bot.test.js`
Expected: FAIL, entrambi i livelli danno lo stesso stato (le soglie sono costanti).

- [ ] **Step 3: Leggere le soglie dal livello**

In `updateBotInputs`, dove oggi si legge il tuning (accanto a `const rt = { ...DEFAULT_RACELINE_TUNING, ... }`):

```js
    // Le soglie di aggressivita' vengono dal livello scelto in lobby: quanto
    // margine serve per tentare un sorpasso, e quanto si resta attaccati a chi
    // precede. I valori di `medio` sono quelli storici (1.01 e 0.85).
    const aggro = F1Difficolta.soglieDi(game.settings && game.settings.botDifficolta);
```

Poi nei due punti d'uso, al posto delle costanti:

```js
                    if (cornerIsMild && targetSpeed > leaderTargetSpeed * aggro.margineSorpasso) {
```

```js
                        targetSpeed *= 1 - closeness * (1 - aggro.frazioneMinimaInScia);
```

⚠️ Le costanti `BOT_OVERTAKE_PACE_MARGIN` e `BOT_FOLLOW_MIN_FRACTION` **restano nel file con i loro commenti**, che raccontano perché valgono quei numeri (tre tarature successive dopo altrettanti playtest): diventano i valori di `medio` nella tabella, e il commento va spostato lì o si perde la storia. Toglierle dal punto d'uso senza portarsi dietro il perché è come cancellare la spiegazione.

- [ ] **Step 4: Eseguire i test e vederli passare**

Run: `node --test backend/sockets/games/f1Bot.test.js` → PASS
Poi `node --test backend/`: gli stessi 10 rossi della baseline.

- [ ] **Step 5: Commit**

```bash
git add backend/sockets/games/f1Bot.js backend/sockets/games/f1Bot.test.js
git commit
```
Messaggio: `A difficile attaccano, a facile ti lasciano passare`

---

### Task 4: La scelta in lobby

**Files:**
- Modify: `frontend/lobby.html:149` (dopo la riga `Drivers`)
- Modify: `frontend/lobby.js:27`

**Interfaces:**
- Consumes: niente. Il valore viaggia da solo: `saveGameSettings` (lobby.js:441-452) legge **tutti** i `<select>` della sezione e ne fa `settings[id senza prefisso] = value`.

- [ ] **Step 1: Aggiungere il select**

In `frontend/lobby.html`, subito dopo la riga di `f1-gridSize`:

```html
                <div class="setting-row"><span>Difficulty</span><select id="f1-botDifficolta"><option value="facile">Easy</option><option value="medio" selected>Medium</option><option value="difficile">Hard</option></select></div>
```

⚠️ **Le etichette in inglese, il valore in italiano.** L'hub e la lobby sono in inglese (è una scelta già presa e registrata), mentre il valore viaggia fino al codice di gioco, che è in italiano come tutto il resto del server.

- [ ] **Step 2: Il valore di partenza**

In `frontend/lobby.js`, riga 27:

```js
        f1: { trackId: 'monte-rosso', botsEnabled: 'true', gridSize: '6', botDifficolta: 'medio' }
```

- [ ] **Step 3: Verificare che arrivi al server**

Non c'è altro codice da scrivere — `saveGameSettings` raccoglie da sé ogni `<select>` della sezione. Il modo di controllarlo è guardarlo:

```bash
node --test frontend/shared/ordineScript.test.js
```

e poi, col server acceso, aprire la lobby, scegliere `Hard`, avviare una gara con i bot e verificare in console che `game.settings.botDifficolta` valga `difficile` — un `console.log` temporaneo in `createBots`, tolto subito dopo.

⚠️ Se il valore non arriva, **non aggiungere codice nella lobby prima di aver capito perché**: il meccanismo generico funziona per `botsEnabled` e `gridSize`, quindi un fallimento qui vuol dire che l'id non segue lo schema `f1-<chiave>` o che il select sta fuori da `#f1-settings`.

- [ ] **Step 4: Commit**

```bash
git add frontend/lobby.html frontend/lobby.js
git commit
```
Messaggio: `La difficolta' si sceglie in lobby`

---

### Task 5: Il campionato ricorda il suo livello

**Files:**
- Modify: `backend/routes/f1Stagioni.js:130`
- Modify: `backend/sockets/games/f1Stagione.server.js:20-30`
- Test: `backend/sockets/games/f1Stagione.server.test.js`

**Interfaces:**
- Consumes: `F1Difficolta.normalizza` dal Task 1.

- [ ] **Step 1: Scrivere il test che fallisce**

In `backend/sockets/games/f1Stagione.server.test.js`:

```js
test('una stagione corre tutte le sue gare allo stesso livello', () => {
    // ⚠️ In campionato i bot sono fissati alla creazione (stesso colore, stesso
    // nome per tutte le gare): il livello e' parte di quella scelta. Se
    // cambiasse da una gara all'altra, la classifica sommerebbe punti presi
    // contro avversari diversi.
    const stagione = {
        _id: 's1', giro: 0,
        calendario: ['prova', 'monte-rosso'],
        piloti: [{ colore: '#fff', bot: true, nome: 'Bot 1' }],
        impostazioni: { gridSize: 6, botsEnabled: true, botDifficolta: 'difficile' },
    };
    const prima = impostazioniPerLaProssimaGara(stagione, {});
    assert.equal(prima.botDifficolta, 'difficile');
    // Seconda gara: stesso livello, non quello che aveva la lobby.
    const dopo = impostazioniPerLaProssimaGara({ ...stagione, giro: 1 }, { botDifficolta: 'facile' });
    assert.equal(dopo.botDifficolta, 'difficile');
});

test('una stagione salvata prima dei livelli corre a medio', () => {
    const vecchia = {
        _id: 's0', giro: 0, calendario: ['prova'],
        piloti: [], impostazioni: { gridSize: 6, botsEnabled: true },
    };
    assert.equal(impostazioniPerLaProssimaGara(vecchia, {}).botDifficolta, 'medio');
});
```

⚠️ Leggere come il file di test costruisce già le sue stagioni finte e riusare quel modo: la forma qui sopra è indicativa, quella vera del file vince.

- [ ] **Step 2: Eseguire il test e vederlo fallire**

Run: `node --test backend/sockets/games/f1Stagione.server.test.js`
Expected: FAIL, `botDifficolta` è `undefined`.

- [ ] **Step 3: Il livello entra nella stagione e ne esce**

In `backend/routes/f1Stagioni.js`, riga 130, dove si costruiscono le impostazioni:

```js
            impostazioni: {
                botsEnabled: botsEnabled !== false,
                gridSize: piloti.length,
                // Il livello si sceglie una volta, alla creazione: i bot di un
                // campionato sono gli stessi per tutte le gare, e la loro
                // difficolta' fa parte di chi sono.
                botDifficolta: F1Difficolta.normalizza(req.body && req.body.botDifficolta),
            },
```

In `backend/sockets/games/f1Stagione.server.js`, dentro `impostazioniPerLaProssimaGara`, accanto a `gridSize` e `botsEnabled`:

```js
        // Il livello del campionato vince su quello della lobby: la gara di
        // oggi deve avere gli avversari di ieri.
        botDifficolta: F1Difficolta.normalizza(
            stagione.impostazioni && stagione.impostazioni.botDifficolta),
```

E in cima al file, il require:

```js
const F1Difficolta = require('../../../frontend/shared/f1Difficolta.js');
```

- [ ] **Step 4: Eseguire i test e vederli passare**

Run: `node --test backend/sockets/games/f1Stagione.server.test.js` → PASS
Poi `node --test backend/`: gli stessi 10 rossi della baseline.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/f1Stagioni.js backend/sockets/games/f1Stagione.server.js backend/sockets/games/f1Stagione.server.test.js
git commit
```
Messaggio: `Un campionato tiene il livello con cui e' nato`

---

### Task 6: Le tre gare, guardate

**Files:** nessuno da modificare — è il playtest.

- [ ] **Step 1: Rimisurare la baseline**

Run: `node --test backend/` e `node --test frontend/shared/`
Expected: gli stessi rossi di partenza, 10 e 5.

- [ ] **Step 2: Una gara per livello**

Server acceso (`node server.js` dalla cartella `backend/`), su `prova`, sei piloti, una gara per livello. Cosa guardare, in quest'ordine:

1. a **Facile** i bot sono *divertenti* o solo lenti? Sbagliano in modo credibile — allargano, perdono l'anteriore — o sembrano fermi?
2. a **Difficile** attaccano in modo credibile o solo fastidioso? Ti passano quando sei lento o si buttano dentro sempre?
3. la differenza fra un livello e l'altro **si sente** dal volante, o serve guardare il cronometro?
4. dentro una gara i bot si sorpassano ancora fra loro, o girano in fila indiana?

⚠️ La domanda 4 è quella che il codice può rompere senza che nessun test se ne accorga: se gli intervalli fossero troppo stretti, la varianza sparirebbe. Il test del Task 2 controlla che gli intervalli non siano un punto solo, non che in gara si veda un sorpasso.

- [ ] **Step 3: Riportare all'utente**

In chat, in breve: i tempi misurati per livello (dal Task 2), cosa si è visto in pista per ciascuna delle quattro domande, e se la taratura va spostata. **La taratura è una decisione dell'utente**: portare i numeri, non cambiarli.
