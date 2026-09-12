# F1 — La pioggia (design)

**Data**: 2026-09-12 · **Stato**: approvato a voce, da trasformare in piano.

Primo progetto F1 dopo l'esaurimento della roadmap 1.0 e della carrellata del
23-08. Nasce da una domanda dell'utente — «adesso mi ritrovo senza una
direzione chiara, cosa potremmo aggiungere?» — e dalla risposta: il meteo è
l'unica feature che rende **diversa ogni gara senza disegnare contenuti
nuovi**, e riusa quasi tutto quello che il gioco ha già pagato (mescole,
usura, strategia ai box, sistema di particelle, cel shading, bot che sanno
quanta aderenza hanno).

## Le decisioni dell'utente, in ordine di risposta

| decisione | scelta |
|---|---|
| come si accende | **un pulsante per provare** ora, meteo **dinamico deciso dal server** quando il bagnato è tarato |
| mescole | **intermedie + pioggia** (cinque in tutto), con finestre e gomma che si distrugge fuori finestra |
| geometria del bagnato | **la traiettoria asciutta si forma davvero**, punto per punto |
| resa | cielo, asfalto, spray **più suono della pioggia e gocce sulla visiera** |
| arrivo della pioggia | **dinamico durante la gara**, «un randomico calcolato»: si parte bagnati e scampa, o si parte asciutti e arriva |
| informazione al giocatore | la **pagina delle gomme deve dire il cielo**, anche nell'anteprima del circuito: «non si verificano scenari dove il gioco non dice niente, selezioni le soft e poi invece piove a dirotto» |
| tutorial | va **aggiornato** quando il bagnato c'è |
| visibilità | **luce rossa lampeggiante** dietro le auto, come nelle gare vere sul bagnato |

## 1. Il dato: chi possiede il bagnato

Modulo nuovo **`frontend/shared/f1Meteo.js`**, richiesto anche dal server —
come `trackGravel.js`, che sta lì e lo usano tutti e due. Nessun Three.js,
nessun DOM: si verifica senza browser, come `f1SensoVelocita`, `f1BoxIngresso`,
`f1Danni`.

Possiede **tre** cose e nient'altro:

1. **Quanto piove adesso** (`pioggia`, 0..1: 0 cielo asciutto, 1 diluvio).
2. **La griglia del bagnato**: una cella ogni **~10 unità di pista misurate
   sull'arco** (non ogni N campioni: il campione vale 1.18 unità su
   `monte-rosso` e 5.17 su `prova`) per **cinque corsie** in larghezza. Un byte
   per cella, 0 asciutta, 255 satura. Le piste vanno da 1177 a 7485 unità: da
   118 a 749 celle in lunghezza, **al massimo 3745 celle, 3.7 KB** a griglia
   intera.
3. **La legge**: la pioggia bagna tutte le celle in proporzione a `pioggia`;
   ogni auto che passa **asciuga la propria cella** in proporzione alla
   velocità; l'evaporazione naturale lavora piano e solo quando la pioggia
   cala.

La corsia laterale si ricava dallo scostamento dal centro **normalizzato sulla
mezza carreggiata di quel campione** (`p.halfWidth`, che varia per tratto):
corsia 0 = bordo destro, 4 = bordo sinistro. La lettura è **interpolata** fra
celle e fra corsie, o l'auto sentirebbe scalini a ogni confine.

La **corsia box non entra nella griglia**: là dentro vale il bagnato del
cielo. Nessuno ci corre.

**Valori di partenza da tarare al banco** (non da sensazione): pioggia piena
porta una cella da asciutta a satura in ~20 s; l'evaporazione naturale ci mette
~5 minuti; un'auto a velocità di gara porta via ~8% del bagnato della cella,
quindi con venti auto la linea asciutta compare in due o tre giri dal momento
in cui la pioggia cala — che è la scala giusta per una gara da cinque minuti.

### Le due strade scartate, con la ragione

- **Il bagnato come proprietà della superficie** (asfalto/erba/ghiaia/cordolo).
  Più elegante in teoria; nella pratica quella funzione è geometria immutabile
  chiesta da quattordici punti, e renderla variabile nel tempo è lo stesso
  allargamento di predicato condiviso che ha piantato sette piloni di viadotto
  sotto il tubo di `loop-prova`.
- **Solo grafica + un moltiplicatore globale di aderenza.** Metà del lavoro,
  ma disegnerebbe una linea asciutta dove il server non ne ha nessuna: il
  giocatore vedrebbe un numero e il server ne calcolerebbe un altro. È il
  difetto che ha reso irraggiungibile la sosta perfetta per giorni.

### Una sola griglia, non due

La griglia è **grossolana per tutti e due**, server e client: non una fine per
la fisica e una riassunta per il disegno. L'asfalto che vedi asciutto è lo
stesso che il server calcola asciutto, per costruzione.

## 2. Il profilo meteo: un randomico calcolato

Il meteo **non** è un dado tirato a ogni tick: è un **profilo generato a
inizio sessione**, cioè una curva di `pioggia` nel tempo della gara. Il server
pesca un **archetipo** e lo sporca con un po' di casualità seminata:

| archetipo | forma |
|---|---|
| asciutto | niente pioggia |
| bagnato che scampa | si parte bagnati, la pioggia cala presto, la pista si asciuga: **tutti devono cambiare** |
| il temporale che arriva | asciutto, poi la pioggia cresce dopo metà gara |
| rovescio breve | un picco corto in mezzo alla gara, poi si asciuga |
| intermittente | due ondate deboli |

Tre ragioni per cui è un profilo e non rumore:

- la gara ha un **arco** — la pioggia che arriva a due terzi e costringe tutti
  dentro nello stesso momento è un fatto, non un caso;
- la **previsione** diventa una cosa che il gioco può dire senza mentire,
  perché il profilo esiste **prima** che il giocatore scelga le gomme;
- un test può **fissare il seme** e verificare la storia, invece di sperare.

Il profilo vive **dentro `f1Meteo.js`** come funzione pura del seme e della
durata: nessuno stato nascosto, e un test lo può riprodurre identico.

**Quando si genera**: prima della fase di scelta gomme, così la pagina può
mostrarlo. Il valore a t=0 **inizializza la griglia**: se si parte sotto la
pioggia, la pista è già bagnata, non si bagna nei primi venti secondi.

**Un profilo per evento, non per sessione.** La qualifica consuma la prima
parte, la gara continua da dove la qualifica ha lasciato, e **la griglia
attraversa le due sessioni**: se in qualifica ha diluviato, la gara parte su una
pista bagnata che si sta asciugando. È la continuità che rende la storia
credibile, e non costa niente — la partita è lo stesso oggetto in tutte le fasi.
⚠️ In qualifica la mescola oggi è forzata (`if (isQuali) return soft`): lì la
sceglie il gioco, e deve scegliere **quella giusta per il cielo di quel
momento**, o si qualificherebbe sul bagnato con le slick.

**La previsione, tre livelli**: `asciutto stabile` / `variabile` / `pioggia in
arrivo`. Dice che qualcosa cambierà, **non a quale giro**: la scelta resta una
scommessa, ma informata. In gara, quando il cielo sta per cambiare, un avviso
dal muretto.

## 3. Come il bagnato diventa lentezza — un punto solo

A ogni tick il server legge la griglia sotto ogni auto e scrive **un numero su
quell'auto**, `p.bagnato`, esattamente come ci scrive `tyreWear`.

Poi il bagnato entra **dentro la mescola**, non accanto alla fisica. Oggi ogni
gomma ha tre numeri (`speedMult`, `gripMult`, `vita`); diventano tre numeri
**in funzione del bagnato**. Tutto il resto scende da solo, perché fisica,
perdita di controllo in curva e bot chiedono **già** quei numeri alla stessa
funzione:

- l'auto scivola di più (`AerodynamicsModel.effectiveGrip` → `applyGripBlend`);
- i bot rallentano nelle curve **da soli**, perché scalano le velocità
  obiettivo su `corneringCapacity`, che nasce dagli stessi numeri. **Nessun
  cervello nuovo da scrivere**;
- la gomma si consuma secondo la sua finestra.

⚠️ **Il verso lo dice la funzione, non il nome.** In `applyGripBlend` un `grip`
più ALTO significa che la velocità conserva la direzione vecchia, cioè
**scivola di più**. Il segno va verificato con un test che misura il
comportamento («sul bagnato l'auto percorre la stessa curva più lentamente e
scivola di più»), non dedotto dal nome della variabile.

**Fuoripista bagnato**: l'erba e la ghiaia bagnate costano un po' di più di
quelle asciutte. Un moltiplicatore modesto sulla penalità che esiste, non un
modello nuovo.

**Gli errori dei bot** crescono col bagnato: è la leva che rende la pioggia
drammatica, e va misurata **per episodio e in larghezze d'auto**, com'è già
tarato tutto il reparto duelli.

**Cosa NON cambia**: la velocità di punta. Il bagnato si sente nelle curve e
nella trazione; togliere anche i chilometri orari in rettilineo è un secondo
effetto che confonde la taratura del primo.

## 4. Le cinque mescole e le loro finestre

| mescola | dove dà il meglio | fuori finestra |
|---|---|---|
| Soft / Medium / Hard | asciutto | l'aderenza crolla appena la pista si bagna |
| **Intermedia** | umido (bagnato ~0.45) | lenta sull'asciutto e **si distrugge** |
| **Pioggia** | diluvio (bagnato ~0.9) | lentissima sull'asciutto e **si distrugge** |

La vita della gomma non è solo «più o meno lunga»: **fuori dalla finestra si
brucia**. È da qui che nasce la tensione «entro adesso o aspetto un giro», ed è
la ragione per cui la full wet su una pista che si asciuga non è una scelta
conservativa ma un suicidio.

⚠️ Il tetto `VITA_MASSIMA_GARA` esiste per impedire che una mescola arrivi in
fondo da sola su una pista dolce. Le due mescole nuove **devono passare dallo
stesso tetto**, o la pioggia riapre il difetto che quel tetto ha chiuso.

⚠️ `TyreModel.giriPerMescola` è **una funzione sola** per la fisica e per il
numero mostrato al giocatore, e va tenuta tale: per le gomme da bagnato la
pagina non promette un numero di giri ma «finché resta bagnato».

**La scelta in corsia** esiste già (`pendingCompound`, applicato alla sosta):
guadagna due pulsanti. **La sosta obbligatoria resta com'è**: la sosta per la
pioggia la soddisfa da sé.

**I bot** ricontrollano la mescola quando il bagnato cambia e vanno ai box se
hanno quella sbagliata — **ognuno con il suo ritardo**: se entrano tutti nello
stesso giro la corsia box diventa una sala d'attesa. Il ritardo dipende dal
livello di difficoltà: un bot forte reagisce prima.

## 5. Cosa arriva al client

Dentro `f1StateUpdate`: `meteo: { pioggia, previsione, celle }`, dove `celle`
sono **solo quelle cambiate** dall'ultimo invio, quantizzate a un byte. La
griglia intera (3.7 KB nel caso peggiore) viaggia una volta a inizio gara e
quando un client si aggancia.

Il client **non calcola** il bagnato: lo riceve. La fisica sta solo sul server,
come per tutto il resto.

## 6. La resa

- **L'asfalto**: il nastro ha già le coordinate UV giuste — `u` attraversa la
  carreggiata, `v` corre lungo la pista, che sono esattamente gli assi della
  griglia. La griglia diventa una **textura minuscola** (cinque pixel di
  larghezza per il numero di celle in lunghezza) aggiornata da un canvas: la
  linea asciutta si vede nascere **perché è lo stesso dato che frena l'auto**.
  Nessuna modifica alla geometria.
- **La pioggia che cade** e **lo spray**: la quarta e la quinta configurazione
  di `f1Particelle` — la pioggia appesa alla camera, lo spray in coordinate
  mondo dietro **ogni** auto, come fanno già i detriti. ⚠️ Un emettitore si
  misura in **nascite al secondo**, non in posti liberi nel pool.
- **La luce rossa da pioggia** dietro ogni vettura: mesh **emissiva
  lampeggiante**, non una luce vera — ventuno luci vere in forward rendering
  sono un ordine di grandezza fuori, misurato col notturno. Aggiunta in codice
  e non nel modello, così lampeggia e si spegne senza toccare il GLB.
- **Le gocce sulla visiera**: in CSS sopra la scena, come la vignettatura della
  velocità (il gioco è legato ai pixel disegnati: niente post-produzione sul
  canvas). Più forti dall'abitacolo, dove il casco ce l'hai in testa.
- **Il suono**: rumore filtrato **sintetizzato** in un modulo audio, come i
  suoni della cerimonia: nessun file da procurare. Volume legato a quanto piove
  e alla velocità, e **appeso alla preferenza di volume esistente**.
- **Cielo e nebbia**: li decide `ToonPalette`, unico proprietario, come per il
  notturno. ⚠️ La pioggia **non si fa abbassando le luci**: la somma delle
  intensità resta ~1 e la nebbia è derivata, o il cel shading si spegne.

## 7. La pagina delle gomme e l'anteprima

Richiesta esplicita dell'utente. In testata, accanto al nome del circuito:
**sta piovendo o no, e quanto**, più la previsione a tre livelli.
L'**anteprima del circuito** al centro si mostra bagnata e con la pioggia che
cade — è la stessa funzione che costruisce la scena del gioco (`f1Scena.js`),
quindi lo sa fare senza codice nuovo.

Le cinque gomme si disegnano col modulo che esiste (`f1Pneumatico.js`): ha già
un test che prevede l'arrivo delle intermedie, e il battistrada più aperto è
l'unico segno che resta quando il colore non si distingue.

## 8. Il pulsante, per tarare

**F3** cicla asciutto → pioviggine → pioggia → diluvio **mentre guidi**, così
si vede anche la transizione e l'asciugatura. Più `?meteo=pioggia`
nell'indirizzo per partire bagnati, come `?notte=on|off`. Visibile **solo con
account amministratore**, come tutti gli altri strumenti di sviluppo, e quindi
spento in produzione.

Non sostituisce il profilo: lo **scavalca**. Quando F3 è attivo il profilo non
tocca più `pioggia`, o si combatterebbero.

## 9. Il tutorial

Una **sesta schermata**: le due gomme da bagnato, la linea che si asciuga, la
luce rossa. Con la sua fotografia scattata in gara sotto la pioggia con gli
strumenti che esistono (F6/F7). ⚠️ Vincolo dettato dall'utente sul tutorial: a
schermo basso **cede la foto, non il testo**, e niente scroll.

## 10. Come si verifica, e cosa deve risultare

- **Test del modulo senza browser**: bagnatura, asciugatura per passaggio,
  evaporazione, lettura interpolata fra celle e corsie, quantizzazione,
  normalizzazione della corsia su una pista a larghezza variabile, profilo con
  seme fissato.
- **Banco prova**: il giro col treno giusto sul bagnato pieno deve stare intorno
  al **+10%** sul tempo asciutto; con le slick sul bagnato pieno molto peggio o
  fuori pista. A ogni livello di bagnato **deve vincere la mescola giusta**: è
  il criterio che dice che le finestre sono tarate.
  ⚠️ I banchi sono rumorosi: mai un run singolo, appaiare i confronti.
  ⚠️ **Non rigenerare la racing line durante la taratura**: si riottimizza sul
  parametro che stai misurando e ti mente.
- **Chrome headless** per visiera, HUD e pagina delle gomme.
- **Playtest dell'utente** con F3, che è il vero giudice della sensazione.

## 11. Trappole note da non ripetere

- `f1.css` ha una regola globale `canvas { position: fixed; width: 100vw
  !important }`: **qualunque canvas nuovo la eredita** e finisce a schermo
  intero. Va disdetta esplicitamente.
- Sostituire un materiale Three vuol dire **ricopiare lo stato di render** —
  qui in particolare la textura del bagnato deve sopravvivere alla
  stilizzazione toon, che rifà i materiali.
- Il bump di versione su `f1.html` va fatto a ogni modifica JS, o il browser
  serve il vecchio e sembra che non sia cambiato niente.
- Un apice inverso dentro un commento spezza il template literal che contiene
  il CSS.
- Le soglie geometriche si esprimono **per unità di pista**, mai per campione.

## 12. Fuori perimetro, per ora

Pozzanghere nei punti bassi, il muro d'acqua che nasconde davvero la pista,
tergicristallo sulla visiera, luci vere, meteo diverso per settore, bandiera
rossa per pioggia troppo forte (è il progetto «direttore di gara», non questo),
e il meteo nel calendario del campionato — che arriva col passo 3 solo se il
bagnato ha funzionato.

## 13. I tre passi di consegna

1. **Si guida sul bagnato.** Modulo, griglia, asciugatura, `p.bagnato`, le
   cinque mescole con le finestre, il profilo meteo, F3, la pagina delle gomme
   che dice il cielo, e il minimo visivo perché si capisca: cielo di temporale,
   asfalto scuro e lucido, la linea che si asciuga. **Qui si decide se la
   pioggia è divertente.**
2. **Si vede e si sente.** Pioggia che cade, spray, luce rossa, gocce sulla
   visiera, suono, nebbia.
3. **Il meteo entra nel resto del gioco.** Probabilità di pioggia per pista,
   qualifica bagnata e continuità con la gara, meteo nel calendario del
   campionato, e la sesta schermata del tutorial con le fotografie vere —
   scattabili solo quando la pioggia è finita e approvata.

⚠️ Il profilo dinamico sta nel **passo 1**, non nel 3: è stata una precisazione
esplicita dell'utente. Il passo 3 è il contorno che lo circonda, non il motore.
