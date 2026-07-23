# F1 — redesign barriera rigida sui tratti ponte (fix "si blocca")

## Contesto

Vedi `docs/superpowers/specs/2026-07-22-f1-terrapieno-e-ponti-design.md` (Fase 3)
e `docs/superpowers/plans/2026-07-22-f1-barriere-ponti.md` per il design e
l'implementazione originali di `applyBridgeBarrier` in
`backend/sockets/games/f1GameSocket.js`.

Dopo il playtest, il comportamento all'urto contro la barriera di un ponte è
stato segnalato come "si blocca" invece di rallentare/scivolare, nonostante
tre tentativi di fix in due sessioni:

1. Smorzamento della sola componente di velocità perpendicolare al muro
   (stile `COLLISION_BOUNCE`, design originale).
2. Redirezione della velocità lungo la tangente della pista con rallentamento
   proporzionale alla frontalità dell'urto (`BRIDGE_BARRIER_SLOWDOWN`,
   implementazione corrente prima di questo documento).
3. Sincronizzazione di `p.speed` (lo scalare usato da `updateVelocity`) alla
   velocità reale post-urto, per eliminare un disallineamento confermato via
   log ("velocità fantasma": `p.speed` restava alto per l'acceleratore tenuto
   premuto, mentre la velocità reale era già stata ridotta dal muro).

Il fix (3) ha eliminato il disallineamento ma la strumentazione runtime
(log server-side ad ogni urto) ha rivelato la vera causa strutturale: il
verso lungo il muro (`forward`, in che direzione far scivolare l'auto) viene
calcolato dal prodotto scalare istantaneo `(p.vx·tx + p.vz·tz)`. Quando
l'urto è quasi frontale (auto puntata quasi perpendicolare al muro — proprio
lo scenario segnalato: sterzo tenuto contro il bordo), la componente
tangenziale residua della velocità è piccola e il suo segno diventa
instabile/quasi casuale tra un urto e l'altro. Log osservato:

```
p.speed=0.41 preHitSpeed=0.42 ... postSpeed=0.41
p.speed=-1.51 preHitSpeed=2.34 vn=0.71 impact=0.71 keep=0.64 postSpeed=1.51
```

`preHitSpeed` (velocità reale) è positivo (2.34) ma `forward` esce negativo:
l'auto viene rediretta ora in avanti, ora indietro, con spostamento netto
vicino a zero — la sensazione di "incastrato" nonostante numeri di velocità
non nulli.

Tre tentativi falliti, ciascuno con un nuovo sintomo in un punto diverso, è
il segnale (skill `systematic-debugging`) per fermarsi e ridiscutere
l'architettura invece di un quarto fix mirato: da qui questo redesign,
discusso e approvato con l'utente in sessione di brainstorming.

## Approccio scelto e alternative scartate

**Scelto — direzione dalla marcia (segno di `p.speed`) + floor minimo
garantito.** Il verso lungo il muro non si calcola più da un vettore
rumoroso al momento del contatto, ma dal segno di `p.speed` **prima**
dell'urto — un valore diretto dell'input del giocatore (acceleratore/freno),
intrinsecamente stabile. Un floor di velocità minima garantita elimina la
dipendenza dalla matematica del rimbalzo per soddisfare il requisito "mai un
blocco totale": non è più una speranza, è una garanzia esplicita nel codice.

**Scartata — isteresi sul segno** (mantenere l'ultimo `forward` noto,
cambiarlo solo con conferma stabile su più tick, stesso schema usato con
successo per il bug "quota a scatti"): più vicina al codice esistente, ma
non garantisce strutturalmente un residuo minimo — un tick isolato quasi
fermo resterebbe comunque possibile mentre l'isteresi "decide". Il segno da
`p.speed` è già stabile per costruzione, l'isteresi diventerebbe ridondante.

**Scartata — barriera "on-rails"** (controllo a binario lungo l'indice
pista mentre a contatto col muro, come l'autopilota box `pitAutoState`):
elimina l'ambiguità alla radice ma introduce un nuovo sottosistema/stato —
sovradimensionato per il problema reale.

## Design

Modifiche tutte contenute in `applyBridgeBarrier` (e stato del player) in
`backend/sockets/games/f1GameSocket.js`.

### 1. Stato persistito `p.bridgeForward`

Nuovo campo sul player, inizializzato a `1` (avanti) alla creazione, stesso
punto in cui oggi si inizializzano `p.speed`/`p.vx`/`p.vz`. Rappresenta
l'ultimo verso di marcia noto lungo la pista, usato come fallback quando
`p.speed` non è abbastanza deciso da indicarne uno (vedi punto 2). Non
resettato tra i giri: rappresenta l'ultima direzione nota per l'intera gara.

### 2. Derivazione di `forward`

Sostituisce il calcolo attuale `(p.vx * tx + p.vz * tz) >= 0 ? 1 : -1`
(rumoroso, causa del bug osservato) con:

```js
const SPEED_DEAD_ZONE = 0.05;
if (p.speed > SPEED_DEAD_ZONE) p.bridgeForward = 1;
else if (p.speed < -SPEED_DEAD_ZONE) p.bridgeForward = -1;
// altrimenti (quasi fermo): mantiene il valore precedente di p.bridgeForward
const forward = p.bridgeForward;
```

`p.speed` è il valore diretto dell'input del giocatore (throttle/brake in
`updateVelocity`), stabile per costruzione — a differenza del prodotto
scalare tra velocità istantanea e tangente, non dipende dall'orientamento
momentaneo dell'auto al contatto.

### 3. Floor minimo di velocità residua

Sostituisce l'assegnazione diretta `speed * keep` con un minimo garantito,
espresso come frazione della velocità MASSIMA dell'auto (non della velocità
pre-urto, che potrebbe già essere quasi nulla per urti precedenti — vanificando
la garanzia):

```js
const MIN_CREEP_FRACTION = 0.18;
const minSpeed   = effectiveMaxSpeed(p, isQuali) * MIN_CREEP_FRACTION;
const finalSpeed = Math.max(speed * keep, minSpeed);
```

`keep` resta invariato (`1 - impact * BRIDGE_BARRIER_SLOWDOWN`): il floor si
applica solo come limite inferiore sul risultato, non sostituisce la logica
di rallentamento proporzionale già esistente per gli urti non frontali.

### 4. Assegnazione finale

```js
p.vx = tx * forward * finalSpeed;
p.vz = tz * forward * finalSpeed;
p.speed = forward * finalSpeed;
```

La sincronizzazione di `p.speed` introdotta nella sessione precedente resta
invariata nel principio, applicata al nuovo `finalSpeed`.

### 5. Casi limite

- **Retromarcia contro il muro**: stessa logica, `p.speed` negativo →
  `forward=-1`, floor minimo garantito anche a ritroso. Nessuna gestione
  speciale.
- **Player fermo spinto da una collisione auto-auto** (non da input
  proprio): `p.speed≈0`, dead zone attiva, si usa `p.bridgeForward`
  persistito (default avanti).

## Fix post-playtest: riallineamento dell'orientamento (wall-riding)

Verificato il redesign sopra (direzione stabile da `p.speed`, floor minimo):
i log confermano progressione sana lungo la pista, nessun blocco reale. Ma
il playtest ha rivelato che il requisito originale non era ancora
soddisfatto: l'utente si aspetta che, sbattendo contro la barriera e
tenendo lo sterzo puntato contro di essa, l'auto **scivoli in automatico**
lungo il bordo (stile "wall-riding" arcade, es. Mario Kart) — non che serva
sterzare via attivamente per staccarsi.

Causa: il redesign corregge solo `vx`/`vz` al contatto, non l'orientamento
(`p.angle`) dell'auto. Se il giocatore continua a tenere lo sterzo puntato
contro il muro, `updateVelocity` (chiamato una volta a inizio tick)
ricrea ad ogni tick una componente di velocità verso il muro a partire da
`p.angle` (mai corretto), che va neutralizzata di nuovo al contatto
successivo — da cui la sensazione di dover sterzare via a mano.

**Fix**: in `applyBridgeBarrier`, oltre a `vx`/`vz`/`p.speed`, si riallinea
anche `p.angle` alla tangente del muro (stesso segno `forward` già
calcolato): `p.angle = Math.atan2(tx * forward, tz * forward)`. Così, anche
tenendo lo sterzo fermo verso il muro, l'orientamento viene ri-agganciato al
bordo ad ogni contatto, e l'auto scivola lungo la barriera in automatico.

## Fix post-playtest 2: clamp per sottrazione invece che per ricostruzione

Dopo il fix precedente (riallineamento di `p.angle`), un nuovo playtest ha
mostrato un blocco reale e confermato via log server (non l'artefatto da
cambio tab del punto precedente): per centinaia di righe `[BRIDGE ...]`
consecutive, nessuna riga `[BRIDGE-IDX ...]` — l'indice pista restava
congelato nonostante `finalSpeed` sano (sempre al floor, 1.17).

Causa: la formula di riposizionamento (`p.x = pt.x + wallNx * limit`)
non spinge indietro l'auto di quanto ha sforato, la **ricostruisce da
zero** sul punto pista campionato più vicino (`pt`) più un offset fisso
lungo la normale — scartando qualunque avanzamento tangenziale reale
appena fatto da `integratePosition`. Finché l'auto usciva e rientrava dal
contatto (prima del riallineamento dell'angolo), la deriva laterale
residua bastava a far avanzare l'indice tra un contatto e l'altro. Dopo
il riallineamento dell'angolo, l'auto resta esattamente parallela al
muro in un equilibrio stabile: il contatto scatta ad ogni sotto-step, e
ogni volta la posizione viene ricostruita sullo stesso punto campionato,
azzerando in continuazione il minimo avanzamento appena fatto — un
blocco reale e permanente.

**Fix**: sottrarre solo l'eccesso lungo la normale dalla posizione
ATTUALE dell'auto, non ricostruirla dal punto campionato:

```js
const overshoot = dist - limit;
p.x -= wallNx * overshoot;
p.z -= wallNz * overshoot;
```

Preserva esattamente la posizione tangenziale raggiunta, azzerando solo
la componente radiale in eccesso — un'auto in equilibrio lungo il muro
avanza quindi liberamente, senza mai essere ricacciata a un punto fisso.

## Fix post-playtest 3: verso di marcia da orientamento × pedale, non solo pedale

Verificato il clamp per sottrazione: comportamento corretto lungo il muro.
Ma l'utente ha segnalato un problema distinto: guidando **contromano**
(auto girata rispetto al verso di marcia canonico) e sbattendo contro la
barriera, il gioco redirige comunque l'auto nella direzione "canonica"
della pista — mentre l'utente vuole poter proseguire contromano se lo
desidera, non essere corretto.

Causa: `forward` si derivava dal solo segno di `p.speed` (accelera/frena),
ignorando **verso dove è orientata l'auto**. Un'auto girata contromano che
accelera ha comunque `p.speed > 0`, quindi veniva assegnato `forward = 1`
(verso canonico) invece del verso reale di marcia (contromano).

**Fix**: il verso di marcia si deriva dal prodotto tra `p.speed` e
l'allineamento tra il muso dell'auto (`p.angle`) e la tangente pista:

```js
const headingAlong = Math.sin(p.angle) * tx + Math.cos(p.angle) * tz;
const travelAlong  = p.speed * headingAlong;
// travelAlong > 0 → forward = 1; travelAlong < 0 → forward = -1
```

Questo cattura il verso di marcia reale in ogni combinazione: marcia avanti
normale, contromano (accelerando con l'auto girata), retromarcia in un
verso o nell'altro — mentre il segno di `p.speed` da solo assumeva sempre
il verso canonico della pista quando si accelerava.

## Fix post-playtest 4: nessuna direzione calcolata (rimozione radicale)

Il fix 3 (verso da orientamento×pedale) non ha risolto il problema di fondo,
e l'utente ha chiarito il vero requisito: la barriera non deve MAI
calcolare/scegliere un verso "giusto" per il giocatore — nemmeno quando
quel calcolo indovina bene (es. la retromarcia veniva rediretta "verso la
direzione corretta", ma l'utente lo considera comunque un aiuto indesiderato,
perché se sta guidando contromano di proposito vuole poter continuare
contromano, non essere corretto).

**Redesign radicale**: si abbandona ogni tentativo di calcolare `forward`
(dalla velocità d'impatto, da `p.speed`, da orientamento×pedale — tre
tentativi, tutti scartati) e ogni riallineamento di `p.angle`. La barriera
torna a fare la cosa più semplice e corretta concettualmente: rimuove SOLO
la componente di velocità che punta ancora verso l'esterno (lungo la
normale del muro), lasciando la componente parallela al muro — qualunque
essa sia, in qualunque verso, anche debole o ambigua — completamente
intatta. Nessun codice decide se il giocatore vuole andare avanti,
contromano o in retromarcia: continua semplicemente a fare quello che
stava già facendo, solo senza poter uscire dal bordo.

Questo approccio era già stato scartato all'inizio di questa indagine
("attempt (a)" nella memoria di progetto) perché sembrava non fare
differenza — ma a quel tempo erano presenti ANCHE il bug del
disallineamento `p.speed`/velocità reale e il bug del riposizionamento per
ricostruzione (che azzerava l'avanzamento tangenziale), entrambi corretti
in questa sessione. Con quei due bug di infrastruttura risolti, l'approccio
concettualmente più semplice (smorzare solo la normale) può funzionare
correttamente.

**Attrito continuo aggiunto** (richiesta esplicita dell'utente,
indipendente dal fix di direzione): mentre l'auto resta a contatto col
muro, si applica un rallentamento sostenuto a tutta la velocità
(`BRIDGE_BARRIER_CONTACT_DRAG`, non solo alla componente normale) ad ogni
sotto-step di contatto — un vero rallentamento fisico, non solo un numero
diverso sul contachilometri, percepibile finché il contatto persiste e non
solo nell'istante dell'urto.

`p.speed` si risincronizza proiettando la nuova `vx`/`vz` sul muso
dell'auto (`vx*sin(angle) + vz*cos(angle)`, stessa convenzione di
`updateVelocity`), non ricostruendolo da un verso scelto — elimina
comunque il disallineamento "velocità fantasma" senza reintrodurre alcuna
logica di direzione.

## Testing

Nessun test automatico per `f1GameSocket.js` (convenzione di progetto:
verifica manuale in localhost). Verifica:

1. `node -c backend/sockets/games/f1GameSocket.js` — nessun errore di
   sintassi.
2. In localhost, sterzo+accelerazione tenuti dritti contro il bordo di un
   tratto ponte per diversi secondi: l'auto deve avanzare visibilmente lungo
   il bordo (non restare ferma), la posizione laterale resta comunque
   sempre sul bordo (sicurezza invariata — non si esce/cade mai).
3. Log di strumentazione già presenti (`DEBUG_BRIDGE_BARRIER`) confermano:
   nessuna inversione imprevista di `forward` durante un urto sostenuto,
   `postSpeed` mai sotto la soglia del floor.
4. Retromarcia contro il muro: comportamento coerente (strisciata
   all'indietro, mai bloccato).
5. Una volta verificato, rimuovere i log temporanei
   (`DEBUG_BRIDGE_BARRIER`/`DEBUG_BRIDGE_HEIGHT` in `f1.js`, già confermato
   risolto per la quota a scatti) e i relativi commenti "TEMPORANEO".
