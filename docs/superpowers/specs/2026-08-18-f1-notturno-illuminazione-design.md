# F1 — illuminazione notturna

**2026-08-18.** Terza stesura del notturno, dopo che le prime due sono state
bocciate al playtest. Questa nasce da una frase dell'utente che ribalta
l'impostazione:

> «il circuito deve essere tutto illuminato costantemente. la luce non arriva
> veramente dai fari. i fari sono accesi solo per estetica.»

più il requisito che era già chiaro e non era mai stato soddisfatto:

> «voglio vedere le ombre sulle macchine che cambiano. voglio vedere il
> circuito acceso.»

## L'errore da cui si riparte

Le prime due stesure facevano **notte = tutto scuro**: una tinta che
moltiplicava ogni superficie verso il buio. Il risultato è stato bocciato tre
volte di fila, e ogni volta la correzione è stata «schiarisci un po' di più»
— cioè cercare la risposta dentro un intervallo che non la conteneva.

Una gara in notturno vera è **tutto illuminato sotto un cielo nero**.
L'asfalto e le auto si vedono come di giorno; quello che dice «è notte» sono
tre cose diverse dalla luminosità delle superfici:

1. il cielo è nero,
2. le sorgenti di luce sono visibili e accese,
3. **lontano il mondo sparisce nel nero** invece di sfumare nella foschia
   azzurra del giorno.

C'è anche una conseguenza che spiega il difetto più grave: **un'ombra ha
bisogno di luce per esistere**. Scurendo tutto avevo spento le ombre, ed è
per questo che «non si vedono le ombre che cambiano» — non perché mancasse
un meccanismo, ma perché non c'era abbastanza luce per renderle visibili.

## Il vincolo che non si tocca

Il cel shading aggancia l'irradianza a **tre fasce fisse** (`BANDS` in
`toonPalette.js`), e quelle fasce hanno senso solo se la somma delle
intensità delle luci resta **intorno a 1**. Misurato il 2026-08-10: con la
somma a 2.1 le tre fasce davano 0.972 / 0.979 / 0.982 a schermo, cioè un
punto percentuale di stacco, e la livrea appariva piatta.

Ne discendono due divieti, validi per tutto quel che segue:

- **non si abbassano le intensità** per fare notte;
- **non si aggiungono luci** — nemmeno una, nemmeno vicino all'auto.

Quindi il notturno si fa sul **colore** delle superfici e delle luci, sulla
**direzione** della luce, e sulla **nebbia**. Mai sulla quantità di luce.

## Perché non ci sono luci vere sui fari

Proposta dell'utente, valutata e scartata con i numeri.

Su `prova` ci sono **21 torri faro** (una ogni ~246 unità); 14 su
`new-monza`, 5 su `monte-rosso`. Three.js r128 usa il forward rendering:
**ogni luce viene calcolata su ogni pixel di ogni materiale**, senza nessun
taglio per distanza — una luce a due chilometri costa quanto quella sopra
l'auto. Ventuno luci puntiformi valgono quindi ventuno volte il costo
dell'illuminazione per pixel, su un gioco che è già limitato dai pixel (vedi
`project_f1_prestazioni_ombre_cotte` e il pannello F9). Le ombre da una luce
puntiforme sono per giunta una mappa cubica: sei render per luce per frame.

Non è una questione di ottimizzazione: è un ordine di grandezza fuori
budget. E siccome l'utente ha stabilito che **la luce non arriva dai fari**,
non serve nemmeno provarci: i fari restano scenografia accesa.

## Perché nemmeno una luce attaccata all'auto

Idea dell'utente, scartata per due ragioni indipendenti.

1. Una luce solidale all'auto produce un'ombra **immobile rispetto
   all'auto**: sempre nello stesso punto, qualunque cosa il giocatore faccia.
   È il contrario del requisito.
2. Aggiungerebbe irradianza proprio dove il giocatore guarda, portando la
   somma sopra il tetto e schiacciando le tre fasce sulla livrea — il difetto
   già misurato sopra.

L'intuizione («qualcosa deve seguire l'auto») è però giusta, e viene
raccolta dal punto 4 qui sotto: a seguire l'auto è la **direzione** della
luce, non una luce nuova.

## Il progetto, in quattro punti

### 1. Le superfici tornano quasi luminose come di giorno

La tinta notturna smette di scurire e si limita a **raffreddare**. Obiettivi
misurabili, in luma:

| superficie | di giorno | di notte (obiettivo) |
|---|---|---|
| prato | 0.51 | ~0.42 |
| asfalto | 0.41 | ~0.60 |

L'asfalto di notte è **più chiaro che di giorno**: è la superficie su cui le
torri faro sono puntate. Il prato è appena più scuro del giorno. La
differenza fra i due resta piccola — l'illuminazione è uniforme, come
richiesto — ma non nulla.

Le tre fasce del cel shading restano ben separate: sull'asfalto danno
0.27 / 0.43 / 0.60.

### 2. La nebbia diventa nera, e un po' più densa

È il punto che vende il notturno tenendo tutto visibile. Il colore della
nebbia non è un parametro indipendente: **è il cielo all'orizzonte**, per
costruzione (`fogColor() === skyColorAt(0)`), e l'orizzonte notturno è già
quasi nero (luma 0.085). Alzando la densità da 0.0011 a 0.0018, il mondo a
duecento metri comincia a dissolversi nel nero mentre la pista sotto l'auto
resta illuminata.

Non è il velo lattiginoso bocciato al primo giro: quello dipendeva dal
**colore** chiaro della nebbia, non dalla sua quantità.

### 3. La luce arriva dall'alto, non di taglio

Oggi la direzionale sta a **60.8°** di elevazione, come un sole di
pomeriggio: l'ombra di un oggetto alto 1 è lunga 0.56. Una torre faro
illumina da trenta metri sopra la pista. Portando l'elevazione a **78°**
l'ombra scende a 0.21 — corta e appiccicata sotto l'auto, che è una delle
cose che si riconoscono subito in una gara notturna.

Vale solo di notte; di giorno l'inclinazione resta quella di adesso.

### 4. La direzione della luce arriva dal faro più vicino

L'**intensità** resta uniforme su tutto il circuito (requisito dell'utente),
ma la **direzione** no: si prende la direzione orizzontale dalle torri più
vicine all'auto, mescolata con peso inverso alla distanza, e la si combina
con l'elevazione fissa del punto 3.

Guidando, ogni ~245 unità l'azimut ruota: l'ombra dell'auto gira attorno alla
macchina e cambia lato passando da un faro all'altro. È il requisito «le
ombre sulle macchine che cambiano», e **costa zero**: quella luce e quella
mappa d'ombra si pagano già oggi.

#### Quello che la misura ha cambiato

La prima stesura di questo punto era «somma pesata dei versori orizzontali,
peso 1/d⁴, elevazione fissa». Una sonda headless che percorre un giro di
`prova` con le 21 torri vere l'ha bocciata **prima del playtest**: lo scatto
peggiore fra due campioni era **170°**, cioè l'ombra che si ribalta
dall'altra parte dell'auto in un lampo.

La causa è geometria, non taratura: la direzione orizzontale da una torre
all'auto **si inverte** nell'istante in cui la si supera, ed è esattamente
lì che quella torre pesa più di tutte. Nessuna scelta di pesi la evita.

Sono state misurate due vie d'uscita.

**Modello fisico** (direzione vera in 3D dal pannello lampade all'auto,
quota 30): risolve lo scatto — sotto la torre la luce punta a picco e la
componente orizzontale va a zero da sola — ma **è stato scartato**, perché
con torri alte 30 e distanti 246 l'elevazione risultante sta fra **4° e
16°** quasi ovunque: luce radente e ombre lunghissime, l'opposto del punto
3. Del resto la luce non arriva davvero dai fari, quindi non c'è ragione di
essere fedeli alla loro geometria.

**Smorzamento nel tempo** (scelto): il bersaglio resta l'azimut pesato
1/d² con elevazione fissa, ma la direzione vera lo insegue con una costante
di tempo di **0.32 s**. Misurato su un giro a 70 unità/s e 60 fps:

| | senza smorzamento | τ = 0.32 s | τ = 0.8 s |
|---|---|---|---|
| scatto peggiore in un frame | 23.0° | **1.1°** | 0.4° |
| in gradi al secondo | 1380 | **69** | 25 |
| rotazione totale sul giro | 1121° | **905°** | 600° |

A 0.32 s lo scatto diventa una spazzata leggibile e si conserva l'81% del
movimento; a 0.8 s l'ombra diventa pigra e si perde quasi metà del
movimento. Lo smorzamento è legato al **tempo** e non al frame, così a 30
fps l'ombra gira alla stessa velocità che a 60, con un tetto sul passo per
il rientro da una scheda lasciata in secondo piano.

Il peso è 1/d² e non 1/d⁴: alla quarta la torre vicina schiaccia tutte le
altre e il bersaglio si muove a strappi. Dopo lo smorzamento le due danno lo
stesso movimento totale, ma al quadrato il bersaglio parte già più docile
(su `monte-rosso`, 4.6° di scatto grezzo contro 12.8°).

Se la somma degenera (fari opposti che si annullano) si tiene la direzione
precedente.

## Costo

**Zero rispetto a oggi.** Nessuna luce nuova, nessuna geometria nuova,
nessun passaggio di post-processing. Il solo lavoro aggiunto è, per frame,
il calcolo della distanza dell'auto da 21 torri sulla CPU — e la CPU non è
il collo di bottiglia di questo gioco.

Restano invece a carico gli aloni delle torri faro introdotti prima di
questa spec: uno sprite additivo per torre, che i pixel li costa davvero.
**Da misurare col pannello F9**, notte contro giorno, e da stringere o
togliere se pesano.

## Cosa resta fuori

- **Pozze di luce sul terreno**: escluse dall'utente, che ha chiesto
  illuminazione uniforme.
- **Luci vere**, di qualunque numero: vedi sopra.
- **Bloom / post-processing** sui fari: darebbe molto, ma è un passaggio a
  schermo intero su un gioco limitato dai pixel. Se un giorno si vorrà, va
  aperto come lavoro a sé con la sua misura.

## Come si verifica

Automatico, in `frontend/shared/toonOrari.test.js`:

- la somma delle intensità di notte è identica a quella di giorno (il
  divieto che regge tutto);
- il prato di notte non scende sotto una soglia rispetto al giorno — cioè
  **il notturno non spegne il mondo**, che è l'errore delle prime due
  stesure;
- l'asfalto di notte è più chiaro che di giorno;
- le tre fasce sull'asfalto illuminato restano separate e nessuna sfonda il
  bianco;
- la nebbia coincide col cielo all'orizzonte, di notte come di giorno.

A mano, in playtest:

- l'ombra dell'auto **cambia lato** percorrendo un giro;
- l'ombra è corta, non allungata;
- il fondo lontano sparisce nel nero;
- il circuito è leggibile ovunque, senza tratti in cui non si vede la pista.
