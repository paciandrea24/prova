# F1 — Vie di fuga in ghiaia (design)

Data: 2026-08-10
Stato: approvato dall'utente in brainstorming, non ancora implementato

## Obiettivo

Aggiungere le vie di fuga in ghiaia all'esterno delle curve, come nei circuiti
reali: dopo il cordolo si apre una fascia di ghiaia, ed è la ghiaia a portare
le barriere bianche e rosse, non più il bordo pista. Le barriere e tutta la
scenografia si allontanano **solo dove c'è la ghiaia**; sui rettilinei nulla si
sposta di un'unità.

Effetto di gioco cercato: chi esce di pista in curva finisce in ghiaia, perde
velocità e non arriva più al prato oltre le barriere — il circuito diventa un
recinto chiuso.

## Decisioni prese (brainstorming 2026-08-10)

> ⚠️ **La larghezza non è più costante.** La riga "25 unità" qui sotto è
> superata: dal 2026-08-11 la larghezza si ricava dalla velocità di percorrenza
> della curva. Vedi la sezione "Larghezza legata alla velocità di curva" in
> fondo, che è la fonte aggiornata.

| Domanda | Decisione |
|---|---|
| Distribuzione | Ghiaia **solo all'esterno delle curve**; barriere spostate solo lì |
| Larghezza | ~~**25 unità**~~ → 32 dopo il primo playtest → **variabile con la velocità** (2026-08-11) |
| Attrito della ghiaia | **Identico all'erba di oggi**: nessuna modifica alla fisica del fuoripista |
| Barriere | **Muro solido su tutto il tracciato** (oggi lo sono solo sui ponti) |
| Curve su terreno sopraelevato | **Niente ghiaia**: come su un viadotto vero |
| Baku | Resta invariata: tutte le sue curve sono su tratti a ponte |

### Perché non una fascia costante su tutto il giro

Misurato sui quattro tracciati: la corsia box corre a 19.8-29.3 unità dall'asse
pista (bordo interno, esclusi gli imbocchi). Una barriera a 40 unità su tutto il
giro se la sarebbe inglobata su prova, new-monza e baku. La fascia costante era
impraticabile a prescindere dall'estetica.

### Spazio realmente disponibile nelle curve

`findCorners()` sui tracciati reali, con lo spazio libero sul lato esterno prima
di incontrare la corsia box:

| pista | giro | curve | su ponte | a terra ma in quota | spazio libero |
|---|---|---|---|---|---|
| prova | 5170 | 13 | 2 | 4 (rampe, fino a y=10.5) | > 30 in tutte |
| new-monza | 3205 | 6 | 0 | 0 | > 30 in tutte |
| monte-rosso | 1177 | 4 | 0 | 0 | > 30 in tutte |
| baku | 2706 | 10 | 10 | 0 | — |

Nessuna curva ha la corsia box vicina: la ghiaia da 25 ci sta ovunque serva. Il
controllo di prossimità va implementato lo stesso, perché l'editor permette di
disegnare piste qualsiasi e una pista futura può violare questa condizione.

Copertura attesa: ghiaia su ~19% del giro di prova (9 curve su 13), ~23% di
new-monza (6 su 6), ~17% di monte-rosso (4 su 4), 0% di baku.

## Architettura

### Il profilo di ghiaia è la sorgente unica

Modulo nuovo `frontend/shared/trackGravel.js`, condiviso client/server con lo
stesso schema UMD di `trackGeometry.js` (che il backend già richiede). Espone il
**profilo**: per ognuno dei 1000 campioni della pista e per ciascuno dei due
lati, quante unità di ghiaia ci sono in quel punto (0 = nessuna).

Da quel singolo numero discende tutto il resto:

```
barriera(i, lato) = roadHalf + CURB_W + 1.2 + ghiaia(i, lato)
```

Dove la ghiaia è 0 la formula restituisce esattamente la distanza di oggi, senza
casi particolari: i rettilinei restano identici per costruzione, non per una
regola scritta a parte.

API:

- `gravelProfile(trackPts, opts)` → `{ left: Float64Array, right: Float64Array }`
  con `opts = { roadHalf, curbW, pitLanePts, pitRoadHalf }`.
- `barrierDistAt(profile, i, side)` → distanza della barriera in quel campione/lato.
- `barrierDistAtPoint(profile, trackPts, x, z)` → per i piazzamenti sparsi della
  scenografia (natura, rocce, laghetto), che non hanno un indice di partenza:
  ricava indice e lato dal punto pista più vicino e dal segno della normale.
- `pitGapSamples(pitLanePts)` → i campioni di corsia box che aprono il varco
  nella barriera (vedi sotto).

### Regole che generano il profilo

Per ogni curva restituita da `findCorners(trackPts)`, sul solo **lato esterno**
(che la funzione già calcola come `side`):

1. La zona si estende **15 unità prima e dopo** gli estremi della curva, per
   coprire la zona di frenata e l'uscita.
2. Agli estremi la larghezza sale da 0 a 25 su una **rampa di 12 unità**: il
   muro non deve avere gradini, altrimenti un'auto che striscia la barriera in
   uscita di curva ci sbatte contro di spigolo.
3. La larghezza si **azzera** dove almeno una di queste condizioni è vera:
   - il campione è su un tratto a ponte (`p.bridge`);
   - il terreno è sopraelevato (`|p.y| > 0.5`): niente via di fuga su una rampa,
     e soprattutto niente terrapieno da allargare;
   - la corsia box è troppo vicina su quel lato — la ghiaia si ferma a
     `distanza dalla corsia − pitRoadHalf − 4`. I box giocatore stanno oltre la
     corsia, quindi questo vincolo li protegge implicitamente;
   - il campione ricade nel varco della corsia box (vedi sotto).
4. Se dopo i tagli una zona resta più stretta di 6 unità viene scartata del
   tutto: una linguetta di ghiaia si legge come un errore grafico.

### Il varco della corsia box

Oggi la regola che apre il varco nella barriera vive **solo nel client**
(`pitMergeSamples` in `f1.js`, soglia `BARRIER_PIT_GAP_THRESHOLD = 8`,
`suppressShortRuns(..., 6)`). Con la barriera diventata muro fisico, client e
server devono usare la stessa identica regola: se divergessero, all'ingresso dei
box si sbatterebbe contro un muro invisibile dove il disegno mostra un varco.

`pitMergeSamples` si sposta quindi in `trackGravel.js` come `pitGapSamples` e
viene richiamata da entrambi i lati. Il client continua a passarla a
`buildBarriers`/`buildCurbs` come oggi; il server la usa per sapere dove il muro
non esiste.

## Componenti toccati

**`frontend/shared/trackGeometry.js`** — `findCorners()` si sposta qui da
`sceneryTrackside.js`: ora la usano due sistemi diversi (scenografia e
ghiaia/barriere) e il suo posto è nel modulo di geometria. `sceneryTrackside.js`
la richiama da qui, comportamento invariato.

**`frontend/shared/trackGravel.js`** (nuovo) — il profilo e le sue regole.

**`frontend/shared/trackMeshBuilder.js`** — `buildGravel(container, pts,
roadHalf, curbW, profile)`: banda fra bordo cordolo e barriera, costruita come i
cordoli (stessa tecnica a strisce di triangoli), alla quota della pista.
`buildBarriers` accetta come `distFromCenter` anche una funzione
`(i, side) => distanza`; passandole un numero si comporta esattamente come oggi,
così `track-editor.js` non va toccato.

**`frontend/shared/toonPalette.js`** — colore `gravel` nelle `SURFACES` (beige
sabbia, valore di partenza `0xC9B896`, da tarare al playtest come si è fatto per
asfalto ed erba). Deve restare un intero valido: `toonPalette.test.js` verifica
tutte le voci.

**`frontend/f1.js`** — calcola il profilo una volta dopo il campionamento della
pista, disegna la ghiaia, passa il profilo a `buildBarriers` e a
`generateLayout`. Terrapieno e prato restano invariati: dato che la ghiaia esiste
solo dove la pista è in piano, lì il terrapieno non ha nulla da raccordare.

**`backend/sockets/games/trackLoader.js`** — `buildTrack` calcola lo stesso
profilo con la stessa funzione e lo espone come `track.gravelProfile`, insieme ai
campioni del varco. Nessun dato nuovo nel `.json` delle piste: il profilo è
derivato, quindi non può divergere da quello disegnato.

**`backend/sockets/games/physics/CollisionResolver.js`** —
`applyBridgeBarrier` diventa `applyBarrier` e vale su tutto il tracciato:

- il limite non è più `roadHalf + BRIDGE_BARRIER_MARGIN` fisso, ma
  `barrierDistAt(profile, idx, side)`, dove `side` è il segno della componente
  normale della posizione rispetto al punto pista più vicino;
- sui tratti a ponte il limite resta quello attuale (`roadHalf + 2`), invariato;
- dove il campione è nel varco della corsia box **non c'è muro**;
- la meccanica del contatto non cambia di una riga: si rimuove solo la
  componente di velocità che spinge oltre il muro, mai una direzione scelta
  (Rif. design 2026-07-23 barriera/ponte), stesso attrito di contatto, stesso
  danno all'urto in gara.

I chiamanti da aggiornare sono `VehiclePhysics`/`VehicleDynamics`,
`f1GameSocket.js` (export `physics`) e `backend/tools/f1RaceLineOptimizer.js`.
Il nome vecchio non resta come alias: meglio un rename esplicito che due nomi
per la stessa cosa.

**Scenografia** — **nessuna modifica alla logica di piazzamento.** I sei moduli
(`trackScenery.js`, `sceneryLandmarks.js`, `sceneryTrackside.js`,
`sceneryPaddock.js`, `sceneryCrowd.js`, `sceneryHills.js`) continuano a
calcolare il layout con lo scalare `barrierDist` di oggi; alla fine di
`generateLayout` un **unico passaggio di traslazione** sposta ogni voce verso
l'esterno della quantità di ghiaia presente nel suo punto:

```
per ogni voce del layout:
    trova il campione pista più vicino e da che lato sta
    spostala lungo la normale di ghiaia(campione, lato)
```

Questo è letteralmente il requisito dell'utente — "tutto esattamente come è ora,
semplicemente traslato dopo la ghiaia" — ed è preferibile a riscrivere le ~50
occorrenze di `barrierDist` sparse nei sei moduli:

- dove non c'è ghiaia la traslazione è 0, quindi i rettilinei restano identici
  **per costruzione**, non per una regola scritta a parte;
- i test di scenografia esistenti continuano a valere senza modifiche;
- le distanze reciproche fra oggetti si conservano: gli oggetti nella stessa
  zona traslano insieme, e traslare verso l'esterno di una curva li allontana
  fra loro (raggio maggiore), non li avvicina — nessun rischio di
  compenetrazioni nuove.

La quota `y` va ricalcolata dopo la traslazione con `terrainHeightAt`. Nelle
zone con ghiaia il terreno è in piano per costruzione (la ghiaia si azzera dove
la pista è in quota), quindi in pratica non cambia; il ricalcolo è una garanzia,
non un'ipotesi.

Unica eccezione: le **colline** (`sceneryHills.js`) e il prato non si traslano —
sono terreno, non oggetti, e stanno centinaia di unità più in là.

## Cosa NON cambia

- **La fisica del fuoripista**: `applyOffTrackDrag` resta parola per parola
  com'è. Ghiaia ed erba frenano uguale, quindi non serve che il server sappia
  che superficie sta sotto l'auto, e non c'è alcun rischio di regressione su
  tempi sul giro, bot o simulatore.
- **La racing line**: la geometria della pista non cambia, i file
  `*-raceline.json` restano validi e non vanno rigenerati.
- **Il terrapieno, il prato e le colline**: nessuna modifica (vedi sopra).
- **La corsia box, i box giocatore e i loro autopiloti**.
- **Baku**, che non ha curve fuori dai ponti.

## Casi limite e rischi

- **Muro all'ingresso/uscita box**: il rischio maggiore. Mitigazione: regola del
  varco unica e condivisa, più un test che confronta i varchi calcolati dai due
  lati sugli stessi dati.
- **Auto già oltre il muro**: le vetture in sosta o in corsia box sono guidate
  dall'autopilota ed escluse dal filtro `racing` in `tickGame`, quindi il muro
  non le tocca — stessa condizione che vale oggi per la barriera dei ponti.
- **Gradino di barriera** fra un campione e il successivo: evitato dalla rampa
  di raccordo; va verificato che la differenza fra campioni consecutivi resti
  sotto ~1 unità.
- **Bot che escono in ghiaia**: con il muro non finiscono più nel prato. I bot
  seguono la racing line e ci arrivano di rado; il simulatore rifiuta comunque
  le linee che vanno fuori pista, quindi l'ottimizzatore non ne è influenzato.
- **Gioco più permissivo sui rettilinei**: non cambia nulla lì, perché la
  barriera resta dov'è. Era invece il difetto della fascia costante, scartata.

## Verifica

Test automatici (`node --test`), sullo stile di quelli esistenti per la
scenografia:

1. `trackGravel.test.js` — il profilo è 0 sui rettilinei, > 0 solo sul lato
   esterno delle curve, sempre 0 su ponti e tratti in quota; le rampe non hanno
   salti maggiori di 1 unità fra campioni contigui; una corsia box ravvicinata
   (caso sintetico) azzera la ghiaia.
2. Un test sui **tracciati reali** che verifica gli invarianti, non i numeri
   esatti della tabella sopra (che cambierebbero al primo ritocco di un
   tracciato in editor): su ogni pista la barriera non finisce mai dentro la
   corsia box, prova/new-monza/monte-rosso hanno almeno una zona di ghiaia,
   baku nessuna, e nessuna zona cade su un tratto a ponte o in quota.
3. `CollisionResolver` — il muro trattiene l'auto alla distanza del profilo, non
   c'è muro nel varco della corsia box, sui ponti il limite resta quello attuale.
4. Retrocompatibilità: `generateLayout` senza profilo e `buildBarriers` con uno
   scalare producono esattamente il layout di prima (i test di scenografia
   esistenti devono passare senza modifiche).
5. Traslazione: su un tracciato reale, ogni voce di scenografia in un tratto
   senza ghiaia resta alla posizione identica a prima (confronto voce per voce
   con il layout generato senza profilo); nei tratti con ghiaia si sposta di
   esattamente la larghezza locale, lungo la normale, verso l'esterno.

Verifica finale in localhost da parte dell'utente: aspetto della ghiaia, larghezza
percepita, ingresso/uscita box, e che si finisca davvero in ghiaia — non oltre —
uscendo in curva a velocità piena.

---

## Larghezza legata alla velocità di curva (2026-08-11)

Aggiunta dopo il playtest dei Task 1-5, su richiesta dell'utente. **Supera la
larghezza costante** definita sopra. Implementata prima dei Task 6-7-8, che non
ne sono toccati: leggono tutti il profilo, e il profilo non cambia forma.

### Il problema

Una fascia uguale in ogni curva rende tutti i circuiti uguali a se stessi: un
curvone da 306 km/h e un tornante da 136 hanno la stessa via di fuga. Nei
circuiti veri la via di fuga è dimensionata sull'energia da dissipare, quindi è
larga dove si arriva forte e stretta nei tornanti.

### La velocità viene dalla fisica, non da una stima

Lo sterzo ha un tasso di rotazione massimo, quindi il raggio percorribile a
velocità `v` è `v / tasso`. Invertendo, con il tasso interpolato fra
`TURN_SPEED_LOW` e `TURN_SPEED_HIGH` su `v/MAX_SPEED`, si ottiene in forma
chiusa la velocità massima di una curva di raggio noto — la stessa relazione che
`f1Bot::cornerTargetSpeed` usa per decidere quanto frenare. Se le due
divergessero, la ghiaia sarebbe dimensionata su una velocità che nessuno tiene.

**Il raggio è il minimo lungo l'arco, non quello a metà curva.**
`findCorners` restituisce ora `minRadius` accanto a `radius`. Il punto medio di
una curva fusa da `CORNER_MERGE_GAP` può cadere sul tratto quasi dritto che
unisce due archi: misurato, `radius` vale **8588** sulla curva 1 di new-monza e
**463** sulla 9 di baku, che sono tornanti; `minRadius` dà 48 su entrambe. Con
`radius` quelle curve avrebbero preso la ghiaia più larga del tracciato.

`radius` resta invariato: `sceneryTrackside.js`, l'altro consumatore, non lo
legge nemmeno.

### La mappatura

```
larghezza = max(MIN, GRAVEL_WIDTH_AT_TOP_SPEED · (v/MAX_SPEED)^1.5)
```

| costante | valore | perché |
|---|---|---|
| `GRAVEL_WIDTH_AT_TOP_SPEED` | 47 | fattore di scala, non una larghezza che si vedrà: nessuna curva raggiunge la velocità massima (a quella velocità non è più una curva). Sui tracciati veri produce 12-32 |
| `GRAVEL_WIDTH_EXPONENT` | 1.5 | fra il proporzionale alla velocità (1) e il proporzionale all'energia cinetica (2, la regola dei circuiti veri). Con 2 le curve lente si appiattivano quasi tutte sul minimo, con 1 la differenza non si leggeva |
| `GRAVEL_WIDTH_MIN` | 12 | sotto questa larghezza la via di fuga non si legge come tale. Rete di sicurezza, non manopola: morde solo sul tornante più lento di prova (136 km/h, uscirebbe a 11.8) |

### La regola contro la ghiaia "a goccia"

Una fascia sale, resta piana, riscende. Le rampe sono lunghe **quanto la
larghezza** (45°, che è anche `MAX_SLOPE`), quindi il pianoro vale
`zona − 2·larghezza`. Imporre che il pianoro sia almeno metà della zona
(`MIN_FLAT_FRACTION = 0.5`) dà `larghezza ≤ zona/4`.

Senza questo vincolo una curva veloce ma **corta** chiede più larghezza di
quanta ne possa aprire e richiudere, e diventa una punta invece di una via di
fuga. È il difetto che l'utente ha bocciato sulla curva più veloce di prova
(chiedeva 40 unità su una zona di 82: pianoro 2) — ed era **già presente** sulla
curva corta di monte-rosso con la larghezza costante di prima, senza che nessuno
lo avesse notato.

`zona` è l'intera zona di ghiaia (arco più i due `CORNER_LEAD`), non il solo
arco.

### Le costanti di fisica sono duplicate, e c'è una guardia

`trackGravel.js` sta in `frontend/shared/` ed è caricato dal browser con un tag
`<script>`: non può richiedere `PowertrainModel`/`SteeringModel`, che sono
moduli CommonJS del server. `MAX_SPEED`, `TURN_SPEED_LOW` e `TURN_SPEED_HIGH`
sono quindi ricopiati (stesso precedente di `ENGINE_REF_MAX_SPEED` in `f1.js`).

La copia non è innocua: se la fisica cambia e la copia resta indietro **non si
rompe niente di visibile**, le vie di fuga restano tarate su un'auto che non
esiste più. `backend/sockets/games/trackGravelPhysics.test.js` confronta le due
sorgenti e, soprattutto, verifica la formula contro la sterzata vera — fa girare
l'auto con `SteeringModel` alla velocità che `cornerSpeed` prevede e controlla
che il raggio che ne esce sia quello di partenza.

### Risultato misurato con la funzione di produzione

| pista | larghezze | note |
|---|---|---|
| prova | 12.0 – 31.9 | curva 1 resta a 31.9; la più veloce scende da 40 richieste a 20.7 |
| new-monza | 13.8 – 18.1 | tutte curve lente: nessuna attiva la regola del pianoro |
| baku | — | nessuna ghiaia, invariato |

Pendenza massima del profilo: **1.000 su tutti i tracciati**, mai oltre
`MAX_SLOPE` — nessun gradino nel muro.

Tre curve di prova hanno il pianoro corto (11-38%) perché sono **tagliate a metà
da un ponte**, dove la ghiaia si azzera per scelta: è il comportamento di
sempre, non un effetto di questa regola.

### Cosa non è stato fatto, e perché

**La ghiaia non è dimensionata sulla velocità di ARRIVO** (energia da dissipare
in frenata), che sarebbe la regola FIA letterale. Un tornante in fondo a un
lungo rettilineo avrebbe una via di fuga enorme — l'opposto di quello che
l'utente ha chiesto guardando le mappe. La velocità di percorrenza è la scelta
esplicita, non una semplificazione.

**`CORNER_LEAD` resta fisso a 15** e non cresce con la velocità. Allungare la
zona prima delle curve veloci darebbe loro più spazio per aprire la ghiaia senza
ridurla, ma sposterebbe ghiaia sui rettilinei — proprietà che si vuole tenere.
