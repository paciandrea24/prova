# Il palazzo dei box: un edificio solo, non una fila di moduli — design

**Data:** 2026-09-03
**Blocco:** G, fase 2, voce 3 — seconda stesura.
**Spec madre:** `2026-09-02-f1-paddock-club-design.md`, che questa **supera in
parte**: i due asset di coronamento restano e trovano un impiego nuovo, la posa
«un tetto per ogni edificio» no.

## Perché una seconda stesura

Il coronamento della prima stesura è stato costruito e messo in pista (Task 1-4,
commit `35fd9dc`..`eb46eb1`). Il giudizio dell'utente:

> «i modelli sono buoni. però non mi piace il pattern. abbiamo sia sopra che
> sotto un'alternanza di due modelli e quindi sembra tutto uguale. in questa
> zona dei box ci starebbe anche un unico modello grosso che svolge la stessa
> funzione. ma si dovrebbe adattare alla lunghezza della corsia box.»

E, chiarito subito dopo: **un edificio unico dei VIP, a due piani, con i garage
sotto** — non un tetto appoggiato sopra a ciascun edificio.

Il difetto non è nei due modelli: è che la fila li alterna a due a due, sopra e
sotto, per venti volte di fila. Una fila di moduli che si ripetono in coppia si
legge come un pattern, e nessuna quantità di dettaglio dentro il singolo modulo
lo nasconde.

## Il vincolo che detta tutto: la corsia box non è mai dritta

Misurato su tutte le piste in cartella (`frontend/tracks/*.json`):

| pista | corsia box | rotazione totale | tratto dei box a 20 piloti | quanto gira lì |
|---|---|---|---|---|
| `melbourne` | 632u | 182° | 158u | 8° |
| `shanghai` | 1106u | 402° | 165u | 4° |
| `citta-prova` | 553u | 136° | 195u | 13° |
| `prova` | 512u | 232° | 153u | 23° |
| `suzuka` | 643u | 331° | 159u | 20° |
| `monte-rosso` | 202u | 182° | 151u | 10° |

⚠️ **Non esiste un blocco rigido che copra una corsia così.** Nemmeno il solo
tratto centrale: un volume unico lungo 160 unità posato su `prova` (23°) esce
dal nastro di oltre dieci unità a un capo. Un asset «enorme» rigido è quindi
escluso dalla geometria, non dal gusto.

Restano due modi di avere un edificio unico che si piega:

1. **cotto per pista** — un `.glb` per circuito, generato già curvo: circa 1 MB
   per pista, da ricuocere a ogni pista nuova (nell'editor, prima di cuocerlo,
   il palazzo non si vede) e mai cullabile per pezzi;
2. **fette strette instanziate** — un modello solo, stretto, ripetuto lungo il
   nastro: segue la curva per costruzione, non richiede cottura, resta
   instanziato.

**Scelta dell'utente: le fette strette.** Con un passo di 7.5 unità e la
rotazione peggiore misurata (20° su 160u, cioè 0.9° per fetta), fra una fetta e
la vicina si apre **0.12 unità**: sotto il visibile, e comunque coperta dal
cornicione. Un blocco rigido, alla stessa curvatura, sbaglia di dieci unità.

## La decisione: il primo piano scavalca i garage

I box dei giocatori stanno a passo 15 e il loro modello è largo 14.1: **a terra
restano 0.9 unità libere fra un box e il vicino**. Non c'è posto per un pilastro
del palazzo, e non c'è modo di inglobare quei modelli — sono ricolorati con la
livrea di ciascun pilota e li carica `pitBoxLoader`, non la scenografia.

Quindi il palazzo si costruisce **a sbalzo**: la facciata a pilastri e logge sta
tutta al primo piano, il solaio passa sopra le teste dei garage, e il piano
terra è occupato dai box — quelli colorati dei giocatori dove ci sono, garage
neutri altrove.

```
              ||~~~~~~||~~~~~~||~~~~~~||~~~~~~||~~~~~~||   balconata, quota 18
              ||######||######||######||######||######||   logge vetrate
     ---------++------++------++------++------++------++   solaio, quota 11
     [garage] |[box 1]|[box 2]|[box 3]| garage | garage |   piano terra
     ~~~~~~~~~~~~~~~~~~~ corsia box ~~~~~~~~~~~~~~~~~~~~
```

È anche com'è fatto un pit building vero, dal Bahrain a Yas Marina.

## I quattro pezzi

Passo **7.5 unità = mezzo passo di box** (`TrackGeometry.PIT_BOX_SPACING / 2`).
Non è un numero scelto per estetica: così il confine di ogni box cade sempre su
un confine di fetta, e nessun box si trova mezzo dentro e mezzo fuori dal
proprio vano. È la regola già imparata sulle facciate della città — decide il
sistema a grana grossa, l'altro eredita.

Il modello si scolpisce **7.3 largo**, più stretto del passo: due lastre piene
che si compenetrano danno facce complanari, cioè z-fighting.

| assetId | contenuto | quando |
|---|---|---|
| `pitClubBay` | garage con serranda sotto, loggia vetrata + balconata sopra | la fetta normale |
| `pitClubSpan` | **solo** il primo piano, piano terra vuoto | dove sotto c'è un box dei giocatori |
| `pitClubHead` | fianco chiuso, scala esterna, insegna sul lato | una per capo del palazzo |
| `pitClubTower` | ingresso, ascensore, volume che sale di due unità | una ogni 8-10 fette |

Quote comuni a tutti: **solaio a 11** (i box dei giocatori sono alti 10, ci passa
sopra con un'unità di franco), **cima a 18.4** parapetto compreso, `pitClubTower`
a 20.4. Profondità **22**, la stessa dei box, così il retro del palazzo è un
piano solo. La fila di oggi arriva a 17.8 (`pitsOffice` + `pitRoofLounge`):
**lo skyline della zona box non cambia**.

Palette e stile: gli stessi di `pitBuildings.py`, con la banda sponsor di
`pitClub.py` riusata sul parapetto. Massimo 6 materiali per asset.

## Chi decide dove: `pitClubProfilo`

Un modulo nuovo, `frontend/shared/pitClubProfilo.js`, sul modello di
`CittaProfilo`: è **l'unico** a sapere dove comincia e dove finisce il palazzo, e
tutti gli altri (la posa, il validatore, i test) glielo chiedono.

1. **Il tratto** è quello dei box a **20 piloti sempre**, non a quanti ne giocano.
   `gridSize` arriva dalla lobby e cambia da una gara all'altra: un palazzo che
   si accorcia con pochi piloti cambierebbe pista fra una gara e l'altra, e la
   scenografia cotta (mappe immutabili) non potrebbe più valere per entrambe.
   Con 6 piloti i vani che avanzano sono semplici `pitClubBay`, con il garage
   neutro. Misurato: 151-195 unità, cioè **25-30 fette** per pista.
2. **Il passo resta 7.5, e a cedere è la lunghezza**: il tratto si allunga fino
   al primo multiplo intero di 7.5 che lo contiene, più due fette di margine per
   capo (la prima e l'ultima sono le teste). Non il contrario: un passo ricavato
   dividendo la lunghezza per un numero di fette sarebbe 7.4 su una pista e 7.6
   su un'altra, e i box — che stanno a 15 fissi ovunque — smetterebbero di cadere
   sui confini delle fette proprio dove serve. Misurato: **25-30 fette per pista**.
3. **Il nastro del fronte** si ottiene offsettando la corsia di
   `pitRoadHalf + PIT_BUILDING_OFFSET_MARGIN` e lisciandolo.
4. ⚠️ **Lo scostamento è del nastro, non della fetta.** Oggi ogni edificio che
   rischia di finire dentro la corsia si sposta per conto suo di 2, 4, 6 unità
   (`PIT_BUILDING_LANE_PUSH_MAX`): in una fila di volumi staccati non si vede, in
   un muro continuo aprirebbe un gradino in mezzo alla facciata. Il palazzo
   calcola lo scostamento necessario fetta per fetta, ne prende il **massimo** e
   applica quello a **tutte** le fette; solo nelle due fette di testa lo smorza
   a zero, così il palazzo non finisce con uno spigolo staccato dal nulla. Il
   fronte resta una linea sola, e nessuna fetta si muove da sola.

## Cosa resta della fila di oggi

Fuori dal palazzo la corsia tiene gli edifici attuali — `pitsGarageClosed` e
`pitsOffice` — **coi due tetti scolpiti il 02-09**, `pitRoofTerrace` e
`pitRoofLounge`. Isolati e distanti l'uno dall'altro non fanno più pattern: il
difetto era la fila serrata, non i modelli. Il codice del Task 3 resta valido
per loro, e vale solo per loro: dentro il tratto del palazzo gli edifici
decorativi non nascono affatto.

I box dei giocatori non si toccano: stessa posizione, stesso modello, stesso
ricolore.

## La gente

Le ancore sulla balconata di `pitClubBay`, `pitClubSpan` e `pitClubTower`, dentro
`terraceAnchors.json` come già fanno i due tetti — la lezione del Task 4: gli
spettatori nascono dove il modello dichiara un'ancora, non da una lista di
assetId scritta a mano. Da 2 a 3 ancore per fetta, orientate verso la corsia.
Su 25-30 fette fanno 60-80 persone affacciate: lo stesso ordine di grandezza dei
due tetti di adesso, quindi il costo della folla non cambia.

## Il costo

Le fette sono 25-30 per pista contro i circa 20 tetti di adesso, ma sono
**istanze dello stesso modello**: 3-4 InstancedMesh per l'intero fronte, contro
le 2 di oggi. La geometria per fetta è più piccola (7.3 di larghezza contro
13.2). Il conto vero si fa col pannello F9, prima e dopo, come sempre: il
progetto è GPU-bound sui pixel, e un palazzo alto 18 nella zona dove il
giocatore è fermo ne copre parecchi.

⚠️ Dietro la fila, nel tratto del palazzo, oggi la scenografia mette tribunette
e cataste di gomme fra 10 e 20 unità dalla corsia (misurato: `prova` 11u,
`suzuka` 10u, `shanghai` 12u). Un palazzo profondo 22 arriva a 34 dal bordo
corsia e li incrocia. Il palazzo deve quindi entrare nel layout **prima** della
scenografia di contorno, così la porta degli ingombri li ricolloca o li scarta
invece di lasciarli dentro il muro. Quanti se ne perdono per pista è una misura
da fare, non da indovinare.

## Dove vale

Su tutte le piste, cittadine comprese, come deciso il 27-08 per il paddock club.

⚠️ `prova` è congelata sulla scenografia cotta in `frontend/tracks/scenografie/`:
finché non la si ricuoce il palazzo non compare. Per il playtest: `citta-prova`,
`banking-prova`, `nuova-pista`.

## Invarianti e test

Su **ogni** pista della cartella:

1. **Nessuna fetta dentro la corsia box**: ogni angolo dell'ingombro sta almeno
   `PIT_BUILDING_LANE_CLEARANCE` fuori dal bordo.
2. **Nessun buco fra fette consecutive**: la distanza fra i centri di due fette
   vicine non supera il passo più mezza unità.
3. **Nessun gradino**: due fette consecutive non differiscono per più di 0.05
   unità nella distanza dal nastro. È il test che protegge la scelta di scostare
   il nastro intero.
4. **Ogni box dei giocatori sta sotto un `pitClubSpan`**, a 20 piloti come a 6.
5. **Nessun `pitClubBay` sopra un box**: sarebbe un garage dentro un garage.
6. **Il palazzo non è più alto della fila di oggi** (18.4 contro 17.8: la
   tolleranza dichiarata è una unità). L'unica eccezione ammessa è
   `pitClubTower`, che arriva a 20.4 ed è per questo limitata a **una ogni 8-10
   fette, e mai due di fila**: se le torri diventano tante, l'eccezione è di
   fatto la regola e lo skyline è cambiato di nascosto.
7. **Dentro il tratto del palazzo non nasce nessun edificio decorativo**, e fuori
   ne nascono come prima.
8. **Il resto della scenografia è identico**: stesso numero di tribune, alberi,
   infrastrutture, salvo quelle che il palazzo incrocia — che vanno contate, non
   sottintese.
9. Ingombro dichiarato uguale all'ingombro del `.glb`, per tutti e quattro i
   pezzi (`sceneryAssetSizes.js` contro `glbInspect`).

## Cosa NON si fa

- **Non si tocca `prova`** né la sua cottura, se non su richiesta esplicita.
- **Non si tocca il modello dei box dei giocatori**, né la sua posa, né il
  ricolore.
- **Niente marchi reali** sulle insegne del palazzo.
- **Niente cottura per pista**: la strada 1 è scartata, e con essa l'idea di un
  `.glb` per circuito.
- **Non si estende il palazzo a tutta la corsia**: fuori restano gli edifici
  sparsi di oggi, come deciso dall'utente.
