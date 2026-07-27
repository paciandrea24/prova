# F1 — via a semaforo (5 luci) + penalità falsa partenza

## Problema

Oggi il via della gara è un countdown testuale "3-2-1-GO" (`startRaceCountdown` in
`backend/sockets/games/f1GameSocket.js`, stessa funzione/stesso overlay usati anche
per la qualifica). L'utente vuole il semaforo vero da F1 (5 luci rosse che si
accendono una alla volta, poi si spengono tutte insieme = via) SOLO per il via
gara — la qualifica resta un giro secco isolato, senza griglia, quindi il
concetto di "falsa partenza" non ha senso lì e mantiene il countdown attuale.

Chi accelera mentre le luci sono ancora accese prende una penalità di 5s,
scontata al primo pit stop (sosta più lunga di 5s), con una rete di sicurezza
se il giocatore non si ferma mai ai box. Il giocatore in fallo è segnalato a
tutti in tempo reale in classifica (box rosso con "!"), non solo a fine gara.

## 1. Sequenza semaforo (solo via gara)

Costanti nuove in `backend/sockets/games/f1GameSocket.js` (vicino alle altre
costanti PIT_*):

```js
const LIGHT_COUNT      = 5;
const LIGHT_INTERVAL_MS = 1000;   // luce i si accende a i*1000ms (i=0..4)
const LIGHTS_ALL_ON_MS  = (LIGHT_COUNT - 1) * LIGHT_INTERVAL_MS;   // 4000: tutte accese
const HOLD_MIN_MS       = 200, HOLD_MAX_MS = 3000;   // attesa casuale dopo la 5a luce
const FALSE_START_PENALTY_MS = 5000;
```

`startRaceCountdown` cambia da un `setTimeout` fisso a 3000ms a:

```js
function startRaceCountdown(io, lobbyId, game) {
    game.phase              = 'race';
    game.raceEnded          = false;
    game.raceStarted        = false;
    game.raceStartTime      = null;
    game.lightsSequenceActive = true;   // finestra di rilevamento falsa partenza (vedi tickGame)

    const holdMs   = HOLD_MIN_MS + Math.random() * (HOLD_MAX_MS - HOLD_MIN_MS);
    const totalMs  = LIGHTS_ALL_ON_MS + holdMs;

    // holdMs resta SOLO lato server: il client non ha bisogno di conoscerlo
    // in anticipo, gli basta reagire al vero evento f1RaceStarted per
    // spegnere le luci — un timer locale indipendente rischierebbe di
    // disallinearsi per la latenza di rete rispetto al via reale.
    io.to(lobbyId).emit('f1Countdown', { trackName: game.track.name, label: 'GARA', phase: 'race' });

    setTimeout(() => {
        const g = activeGames.get(lobbyId);
        if (!g) return;
        g.lightsSequenceActive = false;
        g.raceStarted   = true;
        g.raceStartTime = Date.now();
        console.log(`🚦 [F1] Gara avviata (lobby ${lobbyId})`);
        io.to(lobbyId).emit('f1RaceStarted', { syncTime: 0, phase: 'race' });
    }, totalMs);
}
```

`startQualifying` (invariata nella logica) deve solo aggiungere `phase:
'qualifying'` al suo emit `f1Countdown` esistente, così il client sa quale dei
due overlay mostrare (testo 3-2-1 vs plancia luci) — oggi il payload non porta
alcuna indicazione di fase.

## 2. Rilevamento falsa partenza

Oggi il client NON invia mai input al server prima che la fisica sia
autorizzata (`isRacing` blocca `maybeSendInputs`, si sblocca solo dentro
`f1RaceStarted`). Va aggiunta una finestra di trasmissione dedicata SOLO per
il rilevamento, senza toccare la fisica: `tickGame` congela comunque tutto
finché `game.raceStarted` è false, quindi ricevere input in anticipo non
rischia mai di far muovere l'auto per davvero.

In `frontend/f1.js`:
- nuova variabile `let lightsSequenceActive = false;`
- `f1Countdown`: se `data?.phase === 'race'`, `lightsSequenceActive = true`
- `f1RaceStarted`: `lightsSequenceActive = false` (oltre a `isRacing = true`
  già esistente)
- `maybeSendInputs()`: la guardia `if (!isRacing) return;` diventa
  `if (!isRacing && !lightsSequenceActive) return;`

Lato server, in `tickGame` (dentro il ramo che oggi si limita a
`broadcastState` quando `!game.raceStarted`):

```js
function tickGame(io, lobbyId, game) {
    if (!game.raceStarted) {
        if (game.lightsSequenceActive) {
            for (const p of Object.values(game.players)) {
                if (!p.falseStart && p.inputs.throttle > 0) p.falseStart = true;
            }
        }
        broadcastState(io, lobbyId, game, false);
        return;
    }
    ...
```

Solo `throttle` conta (non `brake`/`steer`): è il movimento in avanti che
costituisce falsa partenza in F1 vera, non la frenata o lo sterzo da fermi.

## 3. Penalità: 5s scontati al primo pit stop + rete di sicurezza

In `handlePitReactionPress` (`backend/sockets/games/f1GameSocket.js`), dove
oggi si calcola `durationMs` dal tempo di reazione:

```js
    const clamped = Math.min(Math.max(reactionMs, PIT_REACTION_BEST), PIT_REACTION_WORST);
    const t = (clamped - PIT_REACTION_BEST) / (PIT_REACTION_WORST - PIT_REACTION_BEST);
    let durationMs = PIT_DURATION_MIN + t * (PIT_DURATION_MAX - PIT_DURATION_MIN);

    // Penalità falsa partenza scontata qui, alla PRIMA sosta: stesso
    // minigioco di reazione, sosta più lunga di 5s, nessun secondo
    // meccanismo da imparare per il giocatore.
    if (p.falseStart && !p.falseStartServed) {
        durationMs += FALSE_START_PENALTY_MS;
        p.falseStartServed = true;
    }
```

Rete di sicurezza in `checkLap` (nel punto dove oggi si applica
`PIT_PENALTY_MS` per chi non ha mai fatto pit stop, quando `p.lap >=
totalLaps` e il giocatore viene marcato `finished`): se `p.falseStart` è vero
ma `p.falseStartServed` non lo è mai diventato (il giocatore ha finito la
gara senza mai fermarsi ai box), i 5s vanno aggiunti allo stesso `p.time` con
la stessa logica già usata lì per `PIT_PENALTY_MS`:

```js
        if (game.phase === 'race' && !p.hasPitted) {
            p.time += PIT_PENALTY_MS;
            p.pitPenalty = true;
        }
        if (game.phase === 'race' && p.falseStart && !p.falseStartServed) {
            p.time += FALSE_START_PENALTY_MS;
            p.falseStartServed = true;
        }
```

`p.falseStart` NON si azzera quando la penalità viene scontata (`p.time`
aggiornato o sosta allungata): resta vero per tutta la gara come indicatore
storico ("chi ha sbagliato la partenza in questa gara"), coerente con la
richiesta di mostrarlo sempre in classifica, non solo finché non paga.

Reset a ogni nuova gara: in `assignGridSpawns` (dove oggi si azzerano
`hasPitted`/`pitPenalty` per la gara che sta per iniziare) aggiungere
`p.falseStart = false; p.falseStartServed = false;`.

Nuovi campi sull'oggetto giocatore (inizializzazione al join, vicino a
`pitPenalty`): `falseStart: false, falseStartServed: false,`.

## 4. Indicatore live in classifica

`buildPublicState` (server) aggiunge `falseStart: !!p.falseStart` al payload
per-giocatore già inviato in ogni `f1StateUpdate` (accanto a `pitLimiter`).
`endRace`'s podium map aggiunge lo stesso campo (`falseStart: !!p.falseStart`)
accanto a `pitPenalty` già presente, per il pannello di fine gara.

Lato client, `updateStandings()` (`frontend/f1.js`) aggiunge un badge rosso
"!" accanto al pallino colore di ogni riga con `d.falseStart === true` — CSS
nuovo, piccolo box rosso pieno con punto esclamativo bianco, stessa altezza
del pallino colore già presente in quella riga.

## 5. Sequenza visiva (plancia luci)

Nuovo markup in `frontend/f1.html`, dentro l'overlay countdown esistente
(`#countdown-overlay`, che resta l'unico sfondo scurente sia per quali che
gara): un nuovo blocco `#lights-board` (5 cerchi, spenti di default) accanto
al numero testuale `#countdown-number` già esistente — visibili
alternativamente in base alla fase (mostra il numero per la qualifica, la
plancia per la gara).

`frontend/f1.js`, handler `f1Countdown`: se `data.phase === 'race'`, nasconde
`#countdown-number`, mostra `#lights-board`, azzera tutte le luci, poi accende
la luce `i` con un piccolo pop/glow via anime.js ad ogni intervallo di
`LIGHT_INTERVAL_MS` (1000ms, stesso valore lato server) per `i` da 0 a 4
(stagger via `setTimeout`). Le luci restano tutte accese finché non arriva
davvero l'evento `f1RaceStarted` dal server — nessun timer locale per
l'attesa casuale (`holdMs` resta un dettaglio solo server-side, il client non
lo riceve): è la ricezione dell'evento stesso a spegnerle tutte insieme,
garantendo che lo spegnimento visivo coincida sempre con il via vero anche in
presenza di latenza di rete.

## Fuori scope

- Nessuna modifica alla qualifica (resta il countdown 3-2-1 testuale attuale)
- Nessun redesign delle altre schermate (scelta gomme iniziale, scelta gomme
  ai box, reveal "POOOOLE", fine gara) — sotto-progetto separato, da
  brainstormare a parte dopo questo

## File coinvolti

- `backend/sockets/games/f1GameSocket.js` — nuove costanti, `startRaceCountdown`
  riscritta, `tickGame` (rilevamento), `handlePitReactionPress` (penalità),
  `checkLap` (rete di sicurezza), `endRace` (campo `falseStart` nel podio),
  `buildPublicState`, `assignGridSpawns`, inizializzazione giocatore,
  `startQualifying` (solo aggiunta `phase` all'emit)
- `frontend/f1.html` — nuovo markup `#lights-board` (5 luci) dentro l'overlay countdown
- `frontend/styles/f1.css` — stile luci (spenta/accesa) + badge "!" falsa partenza
- `frontend/f1.js` — `lightsSequenceActive`, `maybeSendInputs` (guardia estesa),
  `f1Countdown`/`f1RaceStarted` (gestione plancia luci via anime.js), `updateStandings`
  (badge)

## Verifica

Manuale in localhost, due tab: via gara con almeno un giocatore che preme
accelerazione mentre le luci sono ancora accese (falsa partenza) e uno che
aspetta lo spegnimento (via pulito) — verificare: badge "!" compare subito in
classifica solo per chi ha sbagliato; al primo pit stop di quel giocatore la
sosta dura visibilmente 5s in più; se quel giocatore non si ferma mai ai box,
il suo tempo finale include comunque i 5s extra; qualifica invariata (nessuna
plancia luci, nessun rilevamento falsa partenza lì).
