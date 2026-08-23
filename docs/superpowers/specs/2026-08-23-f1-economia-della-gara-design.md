# F1 — Economia della gara

**Data**: 2026-08-23
**Blocco**: A della scomposizione concordata il 2026-08-23
**Prerequisito**: le stagioni fino al passo 5b (branch `f1-stagioni`).

## Il punto

Oggi la macchina è un oggetto senza memoria. Ogni gara comincia con
un'auto perfetta, ogni sosta la rimette a nuovo, ogni circuito consuma
le gomme allo stesso modo e un'auto piena di benzina si guida come una
vuota. Non c'è niente che il giocatore debba **amministrare**: c'è solo
qualcosa da non rompere.

Questo blocco introduce le conseguenze. Tre valgono ovunque e sono
fisica pura — il peso del carburante, l'abrasività del circuito, il
fondo che si rovina fuori pista. Una vale solo in stagione ed è il
**parco chiuso**: fondo, motore e sospensioni si trascinano da una gara
alla successiva, e fra un weekend e l'altro si decide cosa sostituire
sapendo che costa.

Il vincolo che decide l'architettura: **i modelli fisici non devono
sapere che le stagioni esistono.** Una formula che chiede "siamo in un
campionato?" è il segno che la strada è sbagliata.

## Il contesto

Il 2026-08-23 l'utente ha dettato in un unico messaggio una carrellata
molto più larga di questo blocco: editor dei tracciati, ambientazione
cittadina, bot competitivi, bug di scenografia, banking e giro della
morte, più la domanda se convenga migrare su Unity. Il materiale è stato
scomposto in dodici blocchi indipendenti e l'ordine concordato è:

**0** cantiere aperto (playtest 5b, bug trofeo) → **A** economia della
gara → **B** mappe immutabili → **C** bug di scenografia → **D/E/F**
editor → **G** ambientazione cittadina → **H** bot → **I** rifiniture UI
→ **J** tutorial. Il giro della morte è rinviato e reso condizionale al
banking, che introduce la stessa struttura di nastro orientato.

Su Unity la risposta data è **no**: ~20.000 righe di logica tarata a
mano si riscriverebbero da zero, il multiplayer richiederebbe un server
dedicato che Render free non regge, e si perderebbe la condivisione via
link. Il lag riferito su Render va misurato prima di attribuirlo a
qualcosa: il pannello F9 dice gli fps, e il piano gratuito ha CPU
condivisa e cold start.

Questo documento copre **solo il blocco A**.

## Cosa ha chiesto l'utente

Integrale, dal messaggio del 2026-08-23:

- In stagione **solo l'ala anteriore è riparabile**, come nella F1 vera:
  la cambiano ai box e via. Le altre tre non si toccano durante la gara.
- L'usura delle componenti **si mantiene da una gara all'altra**,
  qualifica compresa: «anche in qualifica avremo questa configurazione e
  non più una macchina perfetta».
- Fra una gara e l'altra si può riparare o sostituire, **subendo una
  penalità in posizioni sulla griglia** della gara successiva,
  proporzionale a quanto si è sostituito. Se hai fatto la pole e hai due
  posizioni di penalità, parti terzo ma col motore nuovo.
- L'ala anteriore è **perfetta all'inizio di ogni gara** e riparabile ai
  box; la sosta costa di più perché non si cambiano solo le gomme. La
  scelta si fa entrando ai box, come oggi col tasto R.
- Le **gare veloci restano come oggi**: riparazione completa.
- Nuovo: **il fondo si rovina andando sull'erba o nella ghiaia.** I
  cordoli **non** devono danneggiarlo.
- Dubbio dell'utente: una piccolissima riduzione di velocità sul
  cordolo. **Scartata** — vedi "Cosa resta fuori".
- **Ogni tracciato consuma le gomme a modo suo.** Piste aggressive
  spingono verso più soste, piste dolci verso una sola. Under-cut e
  over-cut non vanno programmati: vanno resi possibili dando al
  giocatore gli strumenti per calcolarli. Graficamente le piste possono
  restare indistinguibili.
- **Il peso del carburante.** A inizio gara le auto sono piene e si
  guidano in un modo, alla fine sono leggere e si guidano in un altro.
  «non so bene come, però capiamo insieme».

## Le cinque decisioni del brainstorming

1. **Il freno alle sostituzioni è una dotazione stagionale**, non la
   sola penalità. Dentro la dotazione sostituire è gratis; oltre, scatta
   la penalità in griglia. Senza dotazione la strategia ottima sarebbe
   banale: riparare sempre tutto e incassare la penalità sul circuito
   dove si sorpassa meglio. La domanda diventa **quando** spendere il
   ricambio, non **se**.
2. **I bot subiscono la stessa economia**, con una strategia semplice e
   dichiarata. Accumulano già danno vero per componente perché sono
   giocatori a tutti gli effetti. Se ripartissero nuovi ogni volta il
   campionato diventerebbe una discesa, e riparare non sarebbe più una
   scelta ma un obbligo.
3. **Solo il motore consuma dai chilometri.** Ala, fondo e sospensioni
   solo da eventi. È la regola della F1 vera ed è la più economica:
   senza un consumo che scatta anche guidando bene, l'intera economia
   potrebbe restare spenta per una stagione intera.
4. **Il carburante è una curva, non una leva.** Tutti partono pieni e si
   alleggeriscono uguale. Nessuna scelta del carico, nessun indicatore
   nuovo, nessuno stato di fallimento per benzina finita.
5. **Il danno preso in qualifica non entra in gara.** La squadra ripara
   nella notte; il parco chiuso riguarda ciò con cui *arrivi* al
   weekend, non ciò che succede dentro. Tiene il libro mastro a una voce
   sola per weekend e non trasforma un errore in qualifica in una gara
   rovinata.

## Cosa c'è già e non va costruito

Verificato il 2026-08-23.

- **Quattro componenti con effetti distinti**, `DamageModel.js:39-42`:
  `frontWing` → sottosterzo (`SteeringModel.js:42`) e resistenza aero;
  `floor` → aderenza (`AerodynamicsModel.js:43`) e carico;
  `engine` → potenza (`PowertrainModel.js:31,58`);
  `suspension` → rumore di sterzo (`SteeringModel.js:48`).
  I flag aero sono **ON di default** (`!== '0'`): il danno al fondo ha
  già denti veri, non serve inventargli un effetto.
- **Un solo punto di azzeramento**: `resetStatoAuto`, chiamata da
  `assignGridSpawns` (`f1GameSocket.js:1123-1126, 1350`), più la
  riparazione ai box (`:1724`).
- **`applyTyreWear(p, offTrack, track)` riceve già `track`**
  (`TyreModel.js:74`): l'abrasività è una moltiplicazione, nessuna firma
  da cambiare.
- **`applyOffTrackDrag` calcola già la profondità** del fuoripista
  (`VehicleMotionModel.js:25-36`), e `offTrack` scatta solo oltre
  `roadHalf + 2`. Quei 2 sono la fascia del cordolo: **i cordoli sono
  già esclusi, gratis.**
- **Tre agganci moltiplicativi per il peso**, tutti con la stessa forma
  `(p, isQuali)`: `effectiveAccel`, `effectiveBrakeMult`,
  `corneringCapacity`.
- **`suggestStrategy(totalLaps)`** (`TyreModel.js:84`) stima già i giri
  per mescola: basta farle sapere l'abrasività.
- **La riparazione ai box è già a tempo variabile**:
  `REPAIR_MS_PER_DAMAGE_PCT = 150` ms per punto di danno
  (`f1GameSocket.js:289,1664`).
- **Le regole della stagione sono pure e testate**
  (`frontend/shared/f1Stagione.js`, 323 righe, condiviso client/server),
  con le rotte in `backend/routes/f1Stagioni.js`.
- **I bot consultano le formule vere** invece di duplicarle
  (grip-awareness): ereditano peso e danno senza modifiche.

## Il disegno

### 1. `isQuali` oggi vuol dire due cose

`PowertrainModel.js:31-32`, `AerodynamicsModel.js:43`,
`SteeringModel.js:42,48`: la stessa condizione `isQuali ? 1 : …` spegne
**sia** l'usura gomme **sia** il danno alle componenti. Sono due
concetti diversi finiti sotto un nome solo. Il primo è corretto — in
qualifica le gomme sono nuove. Il secondo è un residuo.

**La soppressione del danno si toglie, in entrambe le modalità.** Non si
ramifica la fisica su "siamo in stagione": chi decide se all'inizio c'è
danno è **chi riempie `damageParts`**, non la formula. La gara veloce
parte a zero e non cambia niente; la stagione parte con l'usura
ereditata e funziona senza che nessun modello lo sappia.

Unica conseguenza in gara veloce: sbattere *durante* la qualifica ora si
sente per il resto della qualifica. In griglia si azzera comunque.

Questa fase è **a comportamento invariato per tutto il resto** e va
verificata come tale prima di aggiungerci sopra qualsiasi cosa.

### 2. Il peso del carburante

Un fattore `fuelFactor(p, totalLaps)`: 1.08 al via, 1.00 all'ultimo
giro, lineare. In qualifica vale 1.00 — `isQuali` significa già
serbatoio vuoto, non serve aggiungere nulla.

L'avanzamento è quello **di quel pilota** (`p.lap / totalLaps`,
limitato a 0-1), non quello della gara: la benzina la consuma chi
guida, e un doppiato non può essere leggero come chi lo ha doppiato.

Dove entra:

| Aggancio | Effetto |
|---|---|
| `effectiveAccel` | pieno: accelerazione divisa per il fattore |
| `effectiveBrakeMult` | pieno: frenata divisa per il fattore |
| `corneringCapacity` | **dimezzato** |
| `applyTyreWear` | moltiplicato: pesante consuma di più |

Il dimezzamento in curva non è pigrizia: a forza piena il primo giro
diventa ingiocabile, e la memoria del progetto è esplicita sul fatto che
un flag di guida si misura in curva e non sul tempo sul giro. È il primo
parametro da tarare.

Proprietà emergente da **non** programmare: l'auto si alleggerisce
mentre la gomma si consuma, e le due cose in buona parte si annullano. È
il motivo per cui in F1 i tempi restano piatti. Se emerge, è giusto.

### 3. L'abrasività del circuito

Campo `abrasivita` nel JSON della pista, default `1.0`, intervallo utile
0.75–1.35. Moltiplica il consumo in `applyTyreWear`. Oggi una Medium
dura 5 giri (`WEAR_LAPS_AT_MEDIUM`): a 1.35 ne dura 3.7, a 0.75 ne dura
6.7.

`suggestStrategy` riceve l'abrasività e la schermata delle mescole
mostra i **giri veri di quella pista**, non quelli nominali, più un
indicatore di abrasività. È l'intero contributo del blocco alle
strategie: non implementiamo under-cut e over-cut, diamo i numeri con
cui il giocatore li calcola.

Il valore è invisibile graficamente, come richiesto.

### 4. Il fondo fuori pista

`applyOffTrackDrag` restituisce oggi un booleano ma calcola già la
profondità `k` (0-1). Restituisce entrambi, e il danno al fondo la usa:
sfiorare l'erba costa quasi niente, attraversare la ghiaia costa. I
cordoli non sono toccati.

Vale in **entrambe** le modalità: in gara veloce si ripara ai box, in
stagione resta.

### 5. Il motore che consuma

`engine` cresce con la distanza percorsa **in gara** (non in qualifica:
il danno di qualifica non entra in stagione, quindi contarlo sarebbe una
contabilità che non porta da nessuna parte). Una gara intera costa circa
il 35%, quindi un motore copre poco meno di tre gare.

### 6. Il parco chiuso

Vale **solo in stagione**.

**Al via di ogni weekend** la vettura non parte a zero: parte dallo stato
ereditato, con `frontWing` sempre a zero. `resetStatoAuto` smette di
azzerare e ripristina `p.usuraIniziale` (assente in gara veloce = tutto
a zero). Resta **un solo punto** che decide lo stato iniziale.

È anche il meccanismo che rende vera la decisione 5 senza scriverla da
nessuna parte: `assignGridSpawns` gira sia per la qualifica sia per la
gara, quindi entrambe ripartono da `usuraIniziale` e il danno preso in
qualifica sparisce prima del via.

**Ai box**, `pendingRepair` ripara solo l'ala. Il costo in tempo usa il
meccanismo esistente sulla percentuale dell'ala, più un costo fisso di
cambio ala.

**In officina**, fra un weekend e l'altro, si sceglie cosa sostituire fra
**fondo, motore e sospensioni**. L'ala non compare: è già nuova a ogni
via, non ha dotazione e non ha penalità. Ogni componente ha una
dotazione stagionale; dentro la dotazione è gratis, oltre costa
posizioni in griglia.

## Il documento della stagione

`f1Stagione.js` porta scritto, con le parole dell'utente, che **la
classifica non si salva: si calcola**. Un totale accanto agli eventi
sarebbe un secondo posto dove vive la stessa verità.

Lo stato della vettura segue la stessa regola. Non si salva «il motore è
al 42%». Si salvano **gli eventi**:

- su ogni risultato di gara, l'usura di ogni pilota alla bandiera;
- su ogni risultato di gara, i ricambi decisi **dopo** quella gara.

Lo stato attuale e la dotazione residua sono funzioni pure che rigiocano
la lista dall'inizio. Sono provabili senza server, senza browser e senza
playtest.

**L'officina non è un momento, è uno stato**: «questa stagione è fra due
gare e per la gara N non risulta ancora una decisione». Chi chiude il
browser in officina la ritrova riaprendo la stagione, senza aver perso
la gara appena corsa. Nessuna scelta equivale a nessun ricambio, che è
sempre una risposta valida. L'invariante «chi chiude il browser perde il
weekend, non la stagione» resta vera senza programmarla.

**Conseguenza da mettere in conto, non da scoprire**: l'officina è una
**seconda scrittura** sul documento della stagione, e oggi c'è un test
che protegge l'assenza di scritture oltre quella della bandiera. Va
aggiornato deliberatamente. L'invariante che resta — e che il test deve
esprimere dopo la modifica — è più precisa di prima: **il weekend
scrive una volta sola, alla bandiera**; l'officina non è il weekend, è
un'azione esplicita dell'utente fra due weekend, come creare la
stagione.

L'usura ereditata raggiunge il weekend per la strada già collaudata: il
server riscrive `lobby.gameSettings` e timbra `sessioneF1`, il client
ricarica, e la sessione porta con sé lo stato d'ingresso di ogni pilota.

## La penalità in griglia

Si applica dopo la qualifica, prima che la griglia venga mostrata.
Quando più piloti sono penalizzati si applica prima la penalità più
grande. Chi sfora oltre l'ultima piazzola si ferma all'ultima.

Non è una riga di testo: nella sequenza qualifica → griglia già in
costruzione, «hai fatto la pole e parti terzo» è un momento di scena
gratuito. La sequenza esiste già, va solo alimentata.

## I bot

Ereditano peso, abrasività e danno senza modifiche, perché consultano le
formule vere invece di duplicarle.

In officina applicano una regola dichiarata e leggibile: sostituiscono
un componente sopra il **60%** di usura finché hanno dotazione; esaurita
la dotazione sostituiscono solo sopra l'**85%**, accettando la penalità.
La seconda soglia serve a impedire che si autopenalizzino ogni gara per
un fondo mezzo consumato. La regola sta in
`f1Stagione.js` insieme alle altre, è pura ed è testabile. La
differenziazione per livello di difficoltà appartiene al blocco H e qui
non si fa.

## I numeri proposti

Tutti da tarare; qui c'è il punto di partenza e il perché.

| Cosa | Valore | Perché |
|---|---|---|
| Massa a serbatoio pieno | +8% | reale ~14%, ridotto perché la fisica è arcade |
| Effetto in curva | metà | a forza piena il primo giro è ingiocabile |
| Abrasività | 0.75–1.35 | Medium da 6.7 a 3.7 giri |
| Consumo motore | ~35% a gara | un motore copre poco meno di tre gare |
| Dotazione | `ceil(nGare / 3)` | su sei gare fanno due motori: copri cinque gare e mezza, la penalità verso il finale è quasi inevitabile ma **quando** lo scegli tu |
| Penalità | motore 5, sospensioni 3, fondo 2 | mordono su griglie da 6-10 auto senza essere letali |
| Cambio ala ai box | 2000 ms fissi + 150 ms/punto | il secondo termine esiste già; il primo è il tempo di montare l'ala nuova |
| Soglie dei bot | 60% con dotazione, 85% senza | vedi "I bot" |

La dotazione **si calcola dalla lunghezza della stagione**: le stagioni
hanno lunghezza variabile e un numero fisso avrebbe significati diversi
su calendari diversi.

## Come si verifica

- **Fase 1 a comportamento invariato**: i test della fisica esistenti
  devono restare verdi senza essere ritoccati, tranne quelli che
  asseriscono esplicitamente la soppressione del danno in qualifica.
- **Il peso si misura in curva.** Un +8% di massa può costare l'1,5% sul
  giro e il 12% nelle curve lente: l'A/B si fa con la metrica delle
  curve del banco, non col tempo sul giro.
- **`f1LapSimulator` è rumoroso**: N=30, mai un campione singolo.
- **Il parco chiuso non si playtesta, si prova.** Stato e dotazione sono
  funzioni pure sui risultati.
- **La penalità in griglia** ha bisogno di un test sull'ordine di
  applicazione e sul limite dell'ultima piazzola.

## Cosa resta fuori

- **Soldi, budget, sponsor.** Sarebbero un'economia intera e un blocco a
  sé.
- **La scelta del carico di benzina** e qualunque stato di "finito il
  carburante".
- **Il rallentamento sui cordoli.** Nella realtà il cordolo non toglie
  velocità, toglie stabilità: una penalità secca punirebbe la guida
  corretta e si sentirebbe come un difetto. Se un giorno gli si vorrà
  dare un peso, la strada è una piccola perdita di aderenza, non di
  velocità.
- **Componenti nuove** (cambio, batteria, turbina).
- **Sostituzioni a metà weekend.**
- **Differenziazione dei bot per difficoltà** — blocco H.
- **Il parco chiuso in gara veloce**: resta riparabile per intero.

## Le quattro fasi

1. **Separare `isQuali`.** Comportamento invariato, verificato, punto di
   ripristino.
2. **Il peso del carburante.** Tre agganci, tarato in curva sul banco.
3. **Abrasività e fondo fuori pista.** Una moltiplicazione e una
   profondità; la schermata mescole mostra i giri veri.
4. **Il parco chiuso.** Stato calcolato, officina, dotazione, penalità in
   griglia, strategia dei bot.

Ognuna è playtestabile e committabile da sola.

Le fasi 1-3 stanno in un piano solo: sono tre modifiche di fisica dello
stesso ordine di grandezza, con lo stesso modo di verificarle. **La fase
4 vuole un piano suo**: contiene un modello di stato, una schermata
nuova, l'aggancio alla griglia e una regola per i bot, e mescolarla alle
altre renderebbe illeggibile la sequenza dei playtest.
