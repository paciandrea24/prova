# F1 — danno da collisione, colpa/penalità, riparazione ai box

## Problema

Oggi le collisioni (auto-auto in `resolveCollisions`, auto-barriera in
`applyBridgeBarrier`) sono puro bump arcade: correzione posizionale + scambio
parziale della velocità lungo la normale d'urto, nessuna conseguenza
persistente. L'utente vuole introdurre un danno vero, per spingere tutti
(umani e bot) verso una guida più pulita:

- sbattere contro un altro giocatore o contro le barriere solide (ponti)
  danneggia l'auto, che diventa progressivamente più lenta e instabile;
- il danno si ripara solo ai box, con un tempo di sosta più lungo
  proporzionale a quanto c'era da riparare;
- chi causa la collisione (velocità di avvicinamento maggiore) riceve anche
  una penalità di tempo; la vittima subisce comunque un danno minore, mai una
  penalità;
- tutto questo vale **solo in gara vera**, mai in qualifica — stesso confine
  già usato per l'usura gomme (`applyTyreWear` è già `if (game.phase ===
  'race')`): l'auto è sempre perfetta all'inizio di ogni gara.

Nessuna modifica alla logica di guida dei bot (traiettoria, sorpassi,
aggressività) — l'unica aggiunta lato bot è una scelta strategica ai box
("riparo o no"), stessa categoria di `pickPostPitCompound`/`botPitThreshold`
già esistenti.

La penalità per taglio di curva (menzionata dall'utente insieme a questa) è
un sotto-progetto **separato**, da brainstormare a parte in seguito — non è
in questo documento.

## 1. Stato nuovo per giocatore

In `backend/sockets/games/f1GameSocket.js`, accanto a `tyreWear` (init al
join, reset a inizio gara):

```js
damage:            0,       // 0-100, stessa scala di tyreWear
collisionPenaltyMs: 0,      // accumulato per tutta la gara, sommato a p.time al traguardo
pendingRepair:     false,   // scelta fatta ai box, applicata a completePitStop come pendingCompound
carContacts:       new Set(),   // colori con cui è ATTUALMENTE a contatto (per rilevare un NUOVO urto)
wallContact:       false,       // true se attualmente appoggiato a un muro ponte
```

`p.damage` si azzera **solo** dove oggi si azzera `tyreWear` per l'inizio
gara vera (riga ~693, `p.tyreWear = 0;` in quel blocco) — mai in qualifica,
mai da solo col tempo. `p.collisionPenaltyMs` si azzera nello stesso punto e
in `assignGridSpawns`/`resetPlayers` (stesso trattamento di `pitPenalty`).

## 2. Rilevamento "nuovo contatto"

Il bump attuale (`resolveCollisions`/`applyBridgeBarrier`) gira su ogni
sotto-step (`COLLISION_SUBSTEPS = 13` per tick) finché due auto (o un'auto e
un muro) restano sovrapposte — applicare danno/penalità ad ogni sotto-step
trasformerebbe uno struscio prolungato in un danno mostruoso. Serve rilevare
solo la **transizione** da "non a contatto" a "a contatto".

Punto importante già vero nel codice attuale: `resolveCollisions(players)`
viene chiamata SOLO `if (!isQuali)` (riga ~935 di `tickGame`) — le collisioni
auto-auto sono già completamente disattivate in qualifica. Quindi non serve
alcun controllo di fase aggiuntivo dentro `resolveCollisions`: tutto quello
che succede lì è già implicitamente "solo in gara". Non è invece così per
`applyBridgeBarrier`, che gira "sempre, anche in qualifica" (il muro è un
limite fisico della pista) — lì serve un controllo esplicito per applicare
danno solo in gara pur mantenendo il muro rigido sempre attivo.

### Auto-auto (dentro `resolveCollisions`)

Nei due punti dove oggi la funzione fa `continue` per una coppia non a
contatto (il filtro rapido per distanza e il `separated` del SAT), va anche
ripulito il tracking di contatto:

```js
const dx = b.x - a.x, dz = b.z - a.z;
if (dx * dx + dz * dz > CAR_MAX_REACH * CAR_MAX_REACH) {
    a.carContacts.delete(b.color); b.carContacts.delete(a.color);
    continue;
}
// ... SAT invariato ...
if (separated) {
    a.carContacts.delete(b.color); b.carContacts.delete(a.color);
    continue;
}
```

Poi, subito dopo il calcolo di `rel` già esistente (usato oggi per decidere
l'impulso di rimbalzo), prima o dopo l'impulso stesso:

```js
const avn = a.vx * nx + a.vz * nz;
const bvn = b.vx * nx + b.vz * nz;
const rel = bvn - avn;

const wasInContact = a.carContacts.has(b.color);
if (!wasInContact) {
    a.carContacts.add(b.color);
    b.carContacts.add(a.color);

    const closingRate = -rel;   // quanto si stanno avvicinando in totale (rel<0 = si avvicinano)
    if (closingRate >= MIN_COLLISION_SEVERITY) {
        applyCarCollisionDamage(a, b, avn, bvn, closingRate);
    }
}

if (rel < 0) { /* impulso di rimbalzo esistente, invariato */ }
```

### Auto-barriera (dentro `applyBridgeBarrier`)

Stesso principio con un booleano invece di un Set (un'auto tocca al più un
muro alla volta). La funzione riceve un parametro aggiuntivo `isRace`
(chiamata come `applyBridgeBarrier(p, game.track, !isQuali)`, `isQuali` già
calcolato in `tickGame`):

```js
function applyBridgeBarrier(p, track, isRace) {
    // ... calcolo esistente di idx/pt/dist/limit ...
    if (dist <= limit) {
        p.wallContact = false;   // aggiunto al return anticipato esistente
        return;
    }
    // ... codice esistente di risoluzione (riporto sul bordo + rimozione componente normale) ...

    if (!p.wallContact) {
        p.wallContact = true;
        if (isRace && Math.abs(vn) >= MIN_COLLISION_SEVERITY) {
            applyBarrierDamage(p, vn);
        }
    }
    // ... attrito di contatto esistente, invariato ...
}
```

## 3. Formula del danno

Costanti nuove (vicino a `WEAR_*`), valori di partenza da tarare a vista in
localhost come tutto il resto della fisica del gioco:

```js
const MIN_COLLISION_SEVERITY = 1.0;   // sotto questa velocità di avvicinamento, nessun danno/penalità
const DAMAGE_PER_SEVERITY    = 6;     // % danno per unità di severità oltre soglia
const DAMAGE_CAP_PER_HIT     = 25;    // % danno massimo da un singolo urto
const VICTIM_DAMAGE_FRACTION = 0.18;  // quota di danno che prende la vittima di un tamponamento
```

```js
function collisionDamageAmount(severity) {
    return Math.min(DAMAGE_CAP_PER_HIT, Math.abs(severity) * DAMAGE_PER_SEVERITY);
}

function applyCarCollisionDamage(a, b, avn, bvn, closingRate) {
    // Quanto ciascuno dei due si sta avvicinando all'altro lungo la normale
    // d'urto (orientata da a verso b, vedi commento esistente su nx/nz):
    // avn>0 = a si avvicina a b; -bvn>0 = b si avvicina ad a. Chi ha la
    // componente di avvicinamento maggiore è il colpevole.
    const closingA = avn, closingB = -bvn;
    const faultIsA = closingA >= closingB;
    const [culprit, victim] = faultIsA ? [a, b] : [b, a];

    const dmg = collisionDamageAmount(closingRate);
    culprit.damage = Math.min(100, culprit.damage + dmg);
    victim.damage  = Math.min(100, victim.damage + dmg * VICTIM_DAMAGE_FRACTION);

    applyCollisionPenalty(culprit, closingRate);   // vedi sezione 4
}

function applyBarrierDamage(p, vn) {
    p.damage = Math.min(100, p.damage + collisionDamageAmount(vn));
    // nessuna penalità: ci si fa male da soli.
}
```

## 4. Colpa e penalità di tempo

```js
const COLLISION_PENALTY_PER_SEVERITY = 400;    // ms di penalità per unità di severità oltre soglia
const COLLISION_PENALTY_CAP_MS       = 5000;   // penalità massima da un singolo urto

function applyCollisionPenalty(culprit, severity) {
    const ms = Math.min(COLLISION_PENALTY_CAP_MS, Math.abs(severity) * COLLISION_PENALTY_PER_SEVERITY);
    culprit.collisionPenaltyMs += ms;
    // notifica live (badge + animazione), vedi sezione 7.3
    notifyCollisionPenalty(culprit, ms);
}
```

`p.collisionPenaltyMs` (accumulo di TUTTI gli urti causati in gara, non un
singolo flag) va sommato a `p.time` in `checkLap`, nello stesso punto dove
oggi si aggiungono `PIT_PENALTY_MS`/`FALSE_START_PENALTY_MS`:

```js
if (game.phase === 'race' && p.collisionPenaltyMs > 0) {
    p.time += p.collisionPenaltyMs;
}
```

Nessuna penalità per la vittima, nessuna penalità per urti contro barriera.

## 5. Effetti del danno sulla guida

Tre fasce, che si **aggiungono** (non solo si intensificano) man mano che il
danno cresce — un danno lieve tocca solo la velocità, uno grave accumula
anche aderenza e sterzo instabile:

```js
const DAMAGE_GRIP_THRESHOLD  = 33;
const DAMAGE_STEER_THRESHOLD = 66;

const DAMAGE_SPEED_PENALTY_MAX = 0.30;   // fino a -30% velocità massima a danno 100%
const DAMAGE_GRIP_PENALTY_MAX  = 0.35;   // fino a -35% aderenza, attivo solo oltre la soglia grip
const DAMAGE_STEER_NOISE_MAX   = 0.15;   // rumore massimo sterzo (frazione di TURN_SPEED), oltre soglia steer
```

In `effectiveMaxSpeed`/`effectiveGrip` (stesso pattern già usato per
`tyreWear`):

```js
function effectiveMaxSpeed(p, isQuali) {
    const wearFactor   = isQuali ? 1 : 1 - (p.tyreWear / 100) * WEAR_SPEED_PENALTY;
    const damageFactor = isQuali ? 1 : 1 - (p.damage  / 100) * DAMAGE_SPEED_PENALTY_MAX;
    return MAX_SPEED * tyreOf(p, isQuali).speedMult * wearFactor * damageFactor;
}

function effectiveGrip(p, isQuali) {
    const wearFactor = isQuali ? 1 : 1 - (p.tyreWear / 100) * WEAR_GRIP_PENALTY;
    const gripDamageFrac = isQuali ? 0
        : Math.max(0, p.damage - DAMAGE_GRIP_THRESHOLD) / (100 - DAMAGE_GRIP_THRESHOLD);
    const damageFactor = 1 - gripDamageFrac * DAMAGE_GRIP_PENALTY_MAX;
    return GRIP * tyreOf(p, isQuali).gripMult * wearFactor * damageFactor;
}
```

Rumore sterzo: in `updateVelocity` (dove oggi si calcola l'angolo dallo
`steer` input), se `game.phase === 'race'` e `p.damage > DAMAGE_STEER_THRESHOLD`,
si aggiunge un piccolo offset casuale scalato:

```js
const steerNoiseFrac = Math.max(0, p.damage - DAMAGE_STEER_THRESHOLD) / (100 - DAMAGE_STEER_THRESHOLD);
const steerNoise = (Math.random() * 2 - 1) * steerNoiseFrac * DAMAGE_STEER_NOISE_MAX;
// sommato allo steer effettivo prima di calcolare la velocità di sterzata
```

Isolato in una funzione dedicata (es. `applyDamageSteerNoise`) per non
appesantire `updateVelocity` con logica di danno inline — richiamata solo se
`p.damage > 0`, zero costo altrimenti.

## 6. Riparazione ai box

Nuovo evento socket, stesso pattern di `f1PitCompoundChoice`:

```js
socket.on('f1PitRepairChoice', ({ lobbyId, playerColor, repair }) => {
    const game = activeGames.get(lobbyId);
    if (!game) return;
    const p = game.players[playerColor];
    if (!p || (!p.pitting && !p.pitAutoState)) return;
    p.pendingRepair = !!repair;
});
```

In `handlePitReactionPress`, dove oggi si calcola `durationMs` e si aggiunge
`FALSE_START_PENALTY_MS`:

```js
const REPAIR_MS_PER_DAMAGE_PCT = 150;   // costo in ms per ogni % di danno riparato

if (p.pendingRepair && p.damage > 0) {
    durationMs += p.damage * REPAIR_MS_PER_DAMAGE_PCT;
}
```

In `completePitStop`, dove oggi si applica `pendingCompound`:

```js
if (p.pendingRepair) {
    p.damage = 0;
}
p.pendingRepair = false;
```

Default (nessuna scelta esplicita): **non riparare** — `pendingRepair` parte
`false` e resta tale se il giocatore non tocca il toggle, coerente con "il
tempo extra va scelto attivamente".

### Bot

Euristica minima accanto a `botPitThreshold` in `f1Bot.js`, applicata
solo nel momento in cui il bot decide/esegue la sosta (nessun cambiamento a
guida/traiettoria/sorpassi):

```js
const BOT_REPAIR_DAMAGE_THRESHOLD = 20;   // % danno oltre cui il bot ripara sempre
// al momento di impostare pendingCompound per la sosta imminente:
p.pendingRepair = p.damage >= BOT_REPAIR_DAMAGE_THRESHOLD;
```

## 7. HUD

### 7.1 Danno nel pannello gomme

`buildPublicState` aggiunge `damage: p.damage` al payload (accanto a
`tyreWear`). In `frontend/f1.html`, nel blocco `hud-tyre-open` (accanto a
`hud-tyre-wear-readout`), un readout gemello per il danno:

```html
<div class="hud-tyre-wear-readout">
    <div class="hud-screen"><span class="hud-mono" id="damage-value">0</span><span class="hud-mono">%</span></div>
    <span class="hud-eyebrow">Danni</span>
</div>
```

In `frontend/f1.js`, dove oggi si aggiorna `tyre-wear-value`/`--wear`, stesso
trattamento con `damage`/`--damage`, riusando `wearColor()` per il colore:

```js
const dmg = Math.round(data.damage || 0);
document.getElementById('damage-value').textContent = dmg;
['wFL','wFR','wRL','wRR'].forEach(...);   // già esistente per --wear
document.getElementById('tyre-open').style.setProperty('--damage', wearColor(dmg));
```

`frontend/styles/f1.css`: `.car-chassis`/`.car-wing` passano da colore fisso
a `fill: var(--damage, #2b313c)` (stesso meccanismo di `.wheel`/`--wear`).

### 7.2 Toggle riparazione ai box

Nel pannello `pitstop-panel` (`f1PitLaneEntered`, accanto a dove oggi si
chiama `renderTyreCards` per `pitstop-cards`), un toggle mostrato solo se il
danno attuale (ultimo stato noto lato client per `myColor`) è > 0:

```
[ ] Ripara danni (+2.3s)   ← tempo stimato = damage * REPAIR_MS_PER_DAMAGE_PCT / 1000
```

Click → `socket.emit('f1PitRepairChoice', { lobbyId, playerColor: myColor, repair: true/false })`,
stesso stile visivo essenziale delle tyre-card (nessuna nuova libreria).

### 7.3 Badge penalità in classifica live

Nuovo evento server `f1CollisionPenalty` (emesso dentro `notifyCollisionPenalty`,
broadcast alla lobby: tutti devono vedere la classifica aggiornata):

```js
io.to(lobbyId).emit('f1CollisionPenalty', { color: culprit.color, penaltyMs: ms, totalMs: culprit.collisionPenaltyMs });
```

`buildPublicState` aggiunge `collisionPenalty: p.collisionPenaltyMs > 0` al
payload per-giocatore (per il badge persistente, stesso schema di
`falseStart`).

In `renderStandingRowContent`, badge riusando **esattamente**
`.false-start-badge` (stesso box rosso con "!"):

```js
${(d.collisionPenalty) ? '<span class="false-start-badge collision-badge">!</span>' : ''}
```

Handler `f1CollisionPenalty` lato client: trova il badge nella riga del
colore interessato (creato subito se non c'era, via un `updateStandings`
mirato) e anima la sequenza con anime.js:

```js
socket.on('f1CollisionPenalty', ({ color, penaltyMs }) => {
    const el = standingRowEls[color]?.querySelector('.collision-badge');
    if (!el) return;
    const secs = (penaltyMs / 1000).toFixed(1);
    anime.timeline({ easing: 'easeOutQuad' })
        .add({ targets: el, scale: [1, 1.4], width: [14, 46], duration: 200,
               complete: () => { el.textContent = `+${secs}s`; } })
        .add({ targets: el, duration: 1200 })   // resta leggibile
        .add({ targets: el, scale: 1, width: 14, duration: 200,
               complete: () => { el.textContent = '!'; } });
});
```

`.collision-badge` in CSS eredita `.false-start-badge` più `width` variabile
via la timeline (non fissa a 14px come l'originale) per fare spazio al testo
"+X.Xs" durante l'espansione.

### 7.4 Mescola sempre visibile in classifica

`buildPublicState` già include `compound: p.compound` — nessuna modifica
server. In `renderStandingRowContent`, un cerchietto colorato con lettera
(S/M/H) accanto al pallino colore pilota, colore preso da
`tyreCompoundsInfo[d.compound].color` (già disponibile lato client dalla
schermata scelta gomme iniziale):

```js
const compoundLetter = { soft: 'S', medium: 'M', hard: 'H' }[d.compound] || '';
const compoundColor  = tyreCompoundsInfo?.[d.compound]?.color || '#888';
// <span class="compound-badge" style="background:${compoundColor};">${compoundLetter}</span>
```

Si aggiorna da solo ad ogni `f1StateUpdate` (nessun evento dedicato): dopo un
pit stop, `p.compound` cambia in `completePitStop` e il prossimo stato
broadcast riflette il nuovo valore.

### 7.5 Risultati finali

`endRace`'s podium map aggiunge `collisionPenaltyMs: p.collisionPenaltyMs`
accanto a `pitPenalty`/`falseStart` già presenti. Nel pannello risultati
(`frontend/f1.js`, dove oggi si mostra `+5s FALSE START`), riga aggiuntiva se
`entry.collisionPenaltyMs > 0`:

```
+8.4s COLLISIONI
```

## Fuori scope

- Penalità per taglio di curva — sotto-progetto separato, da brainstormare a
  parte dopo questo.
- Danno visivo sul modello 3D dell'auto (deformazioni, fumo, parti che
  volano) — solo HUD 2D (readout + colorazione SVG pannello gomme).
- Scelta granulare di COSA riparare (es. solo l'ala, non le sospensioni) —
  danno unico 0-100%, riparazione tutto-o-niente.
- Modifiche alla logica di guida/traiettoria/sorpassi dei bot — l'unica
  aggiunta bot è la scelta binaria "riparo se danno oltre soglia" ai box.

## File coinvolti

- `backend/sockets/games/f1GameSocket.js` — nuove costanti (`MIN_COLLISION_SEVERITY`,
  `DAMAGE_*`, `COLLISION_PENALTY_*`, `REPAIR_MS_PER_DAMAGE_PCT`), nuovi campi
  giocatore (init al join + reset a inizio gara), `resolveCollisions` (rilevamento
  nuovo contatto + pulizia `carContacts` — nessun parametro fase nuovo, la
  funzione già gira solo in gara), `applyBridgeBarrier` (rilevamento nuovo
  contatto via `wallContact`, nuovo parametro `isRace` passato dal call site
  in `tickGame` come `!isQuali`), `applyCarCollisionDamage`/`applyBarrierDamage`/
  `applyCollisionPenalty` (nuove),
  `effectiveMaxSpeed`/`effectiveGrip` (fattore danno), `updateVelocity`
  (rumore sterzo via nuova `applyDamageSteerNoise`), nuovo handler socket
  `f1PitRepairChoice`, `handlePitReactionPress` (tempo extra riparazione),
  `completePitStop` (applica repair), `checkLap` (somma `collisionPenaltyMs`
  a `p.time`), `buildPublicState` (campi `damage`/`collisionPenalty`),
  `endRace` (campo `collisionPenaltyMs` nel podio)
- `backend/sockets/games/f1Bot.js` — `BOT_REPAIR_DAMAGE_THRESHOLD` + scelta
  `pendingRepair` nello stesso punto dove oggi si sceglie `pendingCompound`
  per la sosta imminente
- `frontend/f1.html` — readout danno nel pannello gomme, toggle riparazione
  nel pannello pit stop
- `frontend/styles/f1.css` — `.car-chassis`/`.car-wing` con `--damage`,
  `.collision-badge`, `.compound-badge`
- `frontend/f1.js` — aggiornamento readout danno (`--damage`/`wearColor`),
  toggle riparazione (nuovo emit `f1PitRepairChoice`), `renderStandingRowContent`
  (badge collisione animato + badge mescola), handler `f1CollisionPenalty`,
  pannello risultati finali (riga collisioni)

## Verifica

Manuale in localhost, almeno due tab (uno umano + bot attivi):

- **Danno auto-auto**: forzare un tamponamento (un'auto ferma/lenta, l'altra
  a tutta velocità la centra) — verificare che SOLO chi tampona prenda danno
  pieno + penalità, la vittima un danno minore, nessuna penalità a lei;
  badge "!" compare subito in classifica per il colpevole con l'animazione
  "+X.Xs" che si richiude su "!".
- **Soglia minima**: due auto che si sfiorano appena fianco a fianco senza
  urto vero — nessun danno, nessuna penalità a nessuno dei due.
- **Danno barriera**: sbattere contro un muro ponte — solo danno, nessuna
  penalità, nessuna vittima.
- **Fasce di effetto**: verificare che a danno lieve l'auto perda solo
  velocità, a danno medio anche aderenza (più derapate), a danno alto anche
  uno sterzo percettibilmente meno preciso.
- **Qualifica**: ripetere gli stessi urti in qualifica — nessun danno, nessuna
  penalità, fisica del bump identica a oggi.
- **Riparazione**: andare ai box con danno accumulato, NON toccare il toggle
  → uscire ancora danneggiati, sosta di durata normale; ripetere scegliendo
  "ripara" → uscire con danno a 0, sosta visibilmente più lunga in proporzione
  al danno che c'era.
- **Bot**: osservare che un bot con danno oltre soglia ripari automaticamente
  al pit stop successivo, senza cambiamenti percepibili nella sua guida in
  pista.
- **Mescola in classifica**: verificare che il cerchietto S/M/H sia sempre
  visibile per ogni pilota e cambi subito dopo che qualcuno completa un pit
  stop con mescola diversa.
- **Fine gara**: risultati finali mostrano la riga "+X.Xs COLLISIONI" solo per
  chi ha accumulato penalità, sommata correttamente al tempo totale.
