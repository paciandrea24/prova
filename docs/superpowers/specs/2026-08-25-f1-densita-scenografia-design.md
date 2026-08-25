# F1 — La scenografia in proporzione al circuito

Aperto il 2026-08-25, dopo il validatore ([[project_f1_validatore_pista]]) e
l'anteprima esplorabile ([[project_f1_anteprima_esplorabile]]). Sostituisce il
**blocco F** della carrellata ([[project_f1_carrellata_2026-08-23]]) e anticipa
una parte del **blocco G**.

## Da dove nasce

L'utente ha segnalato due cose in un messaggio solo:

1. le piste nuove, più lunghe di quelle vecchie, sembrano **più spoglie** —
   «forse meno tribune... in proporzione il circuito è più vuoto»;
2. se il posizionamento è garantito, il **ritocco a mano degli asset** (blocco
   F) non serve più.

La prima non era un'impressione. La seconda si è ridimensionata da sé: la
garanzia al 100% non c'è, e il perché sta più sotto.

L'idea di partenza era una **manopola** nell'editor per far spuntare più o meno
scenografia. È stata scartata dall'utente stesso una volta vista la causa:
«se rendiamo gli asset proporzionali al giro non c'è bisogno dello slider».
Ed è la conclusione giusta — una manopola che compensa a mano un difetto di
proporzione va girata su **ogni** pista nuova, per sempre.

## Il difetto, misurato

La scenografia ha **un budget per pista, non per unità di lunghezza**. La pista
si allunga di sei volte, gli oggetti no:

| categoria | monte-rosso 1177 | melbourne 3182 | nuova-pista 4389 | shanghai 7485 |
|---|---|---|---|---|
| alberi | 430 | 430 | 430 | 430 |
| spettatori | 4802 | 6125 | 6418 | 6595 |
| rocce | 73 | 80 | 73 | 86 |
| **oggetti / 1000 unità** | **4752** | **2247** | **1717** | **1057** |

E il vuoto che ne risulta, misurato da `sceneryGaps` — che conta solo le
strutture **costruite**, perché «un tratto pieno di alberi è comunque un tratto
in cui non c'è niente da guardare» (utente, 2026-08-13):

| pista | giro | tratto vuoto peggiore | totale vuoto |
|---|---|---|---|
| melbourne | 3182 | 92 | 133 su 3182 |
| nuova-pista | 4389 | **540** | 729 su 4389 |
| suzuka | 4998 | 475 | **1565 su 4998** |

### La causa principale è una riga

`trackScenery.js`, `buildGrandstandLayout`:

```js
const count = Math.max(6, Math.min(18, Math.round(lapLen / 220)));
```

La **formula** è già a densità costante: una schiera di tribune ogni 220 unità.
È il **tetto di 18** a tradirla.

| pista | giro | schiere chieste | ottenute | una ogni |
|---|---|---|---|---|
| melbourne | 3182 | 14 | 14 | 227 |
| new-monza | 3205 | 15 | 15 | 214 |
| nuova-pista | 4389 | 20 | **18** | 244 |
| suzuka | 4998 | 23 | **18** | 278 |
| prova | 5170 | 24 | **18** | 287 |
| shanghai | 7485 | **34** | **18** | **416** |

Shanghai ne chiede trentaquattro e ne riceve diciotto: **una schiera ogni 416
unità invece di ogni 220**, cioè metà della densità di melbourne. Le tribune
restano numericamente tante (103 su nuova-pista contro 79 su melbourne) perché
le schiere superstiti sono più lunghe — ed è esattamente come l'utente l'ha
descritto: «magari numericamente sono di più, ma in proporzione il circuito è
più vuoto».

⚠️ Quel tetto è già stato alzato una volta, da 10 a 18, il 2026-08-13, su
richiesta dell'utente («vorrei vederlo bello pieno»). Allora la pista più lunga
era `prova` a 5170 e 18 quasi bastava. **Alzarlo di nuovo a un numero più
grande ripeterebbe l'errore alla prossima pista lunga.** Il tetto va tolto come
concetto, non ritoccato come numero.

## Il principio della cura

> **Un tetto assoluto su una quantità distribuita lungo il giro è sempre
> sbagliato: la stessa costante descrive densità diverse su piste diverse.**

È la stessa lezione di [[feedback_soglie_geometriche_per_unita_di_pista]],
applicata alle quantità invece che alle distanze.

E una regola operativa che tiene basso il rischio:

> **I tetti si alzano, mai si abbassano.** Il fattore è `max(1, giro / 3200)`.

3200 è melbourne / new-monza: le due piste con vuoto quasi nullo, la densità
che all'utente va bene. Sotto quella lunghezza non cambia niente. Conseguenza
voluta: **monte-rosso, melbourne e new-monza restano identiche**, e le loro
scenografie cotte non vanno rifatte.

## Cosa cambia

Tutte le funzioni interessate hanno già `trackPts` fra i parametri:
`TrackGeometry.lapLength(trackPts)` è disponibile ovunque, **nessuna firma
cambia**.

| dove | oggi | dopo |
|---|---|---|
| `trackScenery.js:891` schiere tribune | `min(18, giro/220)` | `max(6, round(giro/220))` — il tetto sparisce, il pavimento resta |
| `WOOD_MAX_TREES` 430 | fisso | per il fattore `max(1, giro/3200)` |
| `WOOD_CLUSTERS` 60 | fisso | idem |
| `ROCK_ATTEMPTS` 220 | fisso | idem |
| `NATURE_ATTEMPTS` 300 | fisso | idem |
| `POND_ATTEMPTS` 60 | fisso | idem |
| `sceneryCrowd.MAX_TOTAL` 6000 | fisso | **scala col numero di tribune** |
| `sceneryCrowd.MAX_TERRACE` 900 | fisso | idem, con le terrazze |

### Gli spettatori seguono le tribune, e nient'altro

Dettato dall'utente: «io non toccherei gli spettatori o li scalerei con le
tribune, niente di diverso. girando in velocità nella pista non è che si nota
se una tribuna è più piena o meno».

Ha ragione, e questo chiude una tentazione che va scritta perché non torni.
`MAX_TOTAL` **non** è un numero di spettatori: è un budget spalmato su tutte le
tribune (`fillCap = MAX_TOTAL / capienza`), quindi oggi il riempimento crolla
dove le tribune sono tante — 100% su monte-rosso, 62% su melbourne, 48% su
nuova-pista, 39% su `test`. Il codice dichiara pure `FILL_MIN = 0.65` («mai una
tribuna deserta») e poi scrive `min(FILL_MIN, fillCap)`, **scavalcando in
silenzio il proprio minimo su sette piste su nove**.

Alzare il riempimento sarebbe però una modifica che in gara non si vede.
Quindi la regola è la stessa di tutto il resto — **si alza, non si abbassa** —
applicata al numero di tribune invece che al giro:

```js
MAX_TOTAL = 6000 * Math.max(1, tribune / 111)
```

111 sono le tribune di new-monza, la pista più fornita fra quelle su cui 6000
bastava. Sotto quel numero non cambia niente; sopra, la folla cresce **solo
perché le tribune sono di più**, non perché ognuna è più piena:

| pista | tribune (dopo) | riempimento oggi | dopo |
|---|---|---|---|
| monte-rosso | 50 | 100% | 100% |
| melbourne | 90 | 62% | 62% |
| nuova-pista | ~125 | 48% | ~50% |
| shanghai | ~230 | 40% | ~50% |

⚠️ Una costante unica che lasci **tutte** le piste esattamente invariate non
esiste: oggi il riempimento va dal 100% al 39% proprio perché il tetto morde in
modo diverso. Questa formula è il compromesso che non abbassa nessuno e non
stravolge nessuno. `FILL_MIN` resta com'è: il fatto che venga scavalcato è
annotato qui e non si cura in questo lavoro, per non cambiare due cose insieme.

### Cosa NON cambia, e perché

- **I landmark** (podio, torri, ponte semafori, passerella): sono quattro
  oggetti singolari, non un riempimento. Un circuito ha **un** podio.
- **Infrastrutture e barriere di sicurezza**: camminano già il giro e scalano
  bene da sole (19 → 145 oggetti da monte-rosso a shanghai). Non hanno tetti.
- **Nessuna manopola nell'editor.** Deciso dall'utente: la densità è una
  proprietà del generatore, non una scelta per pista.

## Il blocco F, declassato

Non posso garantire il 100%. Quello che **è** garantito: nessun oggetto con
ingombro dichiarato entra nel corridoio della pista per più di 1 unità, su
qualsiasi pista, perché l'invariante enumera la cartella dei tracciati.
Quello che **non** è coperto:

- il **ponte semafori sproporzionato** dove le vie di fuga sono larghe
  (melbourne, shanghai: portale alto 40 unità invece di 16) — vedi
  [[project_f1_scenografia_alla_radice]];
- i **piedi delle passerelle** contro il nastro di un tratto *adiacente*
  (suzuka 0.02, new-monza 0.22): nessuno controlla un portale contro barriere
  che non siano la propria;
- le categorie esenti per mestiere (`safety` sta fra muro e asfalto, i ponti
  scavalcano).

Quindi la valvola manuale resta, ma **a una frazione del costo**: niente
selezione libera in 3D, niente raycast. Il validatore elenca già i difetti e ti
ci porta; accanto alla segnalazione compare **«togli questo oggetto»**.

⚠️ Il principio scritto in testa a `trackValidatore.js` — *«il validatore dice,
non aggiusta»* — resta intatto: il validatore continua solo a dire, e la
rimozione è un'azione dell'**editor**, decisa dall'utente.

**Punto tecnico aperto, da risolvere in fase di piano**: serve un
identificatore stabile per l'oggetto rimosso. L'indice nell'array del layout
**non** lo è — cambia appena si tocca l'algoritmo, e questo lavoro lo tocca. La
strada probabile è `asset` più posizione arrotondata, con la rimozione
applicata dopo `generateLayout` e una segnalazione quando un'esclusione salvata
non trova più il suo oggetto.

## Le conseguenze, dette prima

**Cotture da rifare** (`frontend/tracks/scenografie/`): nuova-pista, test,
suzuka, prova-notturno, shanghai. E **`prova`, che è congelata** — quella si
ricuoce solo su autorizzazione esplicita, ⚠️ e solo dopo aver controllato che
l'utente non abbia `prova.json` modificato in locale
([[project_f1_mappe_immutabili]]).

**Prestazioni.** L'utente ha posto la domanda giusta: se si disegna solo ciò che
si vede, distribuire più asset su una mappa più grande non dovrebbe costare.
Verificato, e in gran parte è così — la camera arriva a 1200 unità, le categorie
pesanti sono già spezzate in celle da 350 con `frustumCulled = true`, e sopra i
50k triangoli una categoria si spezza da sola. Restano due costi veri: le
**ombre** (il sole illumina fino a 520 unità e ridisegna tutto ciò che sta lì
dentro) e **memoria più tempo di caricamento**, che crescono col totale e non
con la vista. Quindi: **A/B col pannello F9 su `prova` prima e dopo**, e se il
costo si vede, il fattore si taglia.
Rif. [[feedback_prestazioni_gpu_pixel_non_drawcall]].

**Test.** ⚠️ `node --test backend/` **non esegue** `frontend/shared/*.test.js`:
servono due comandi. Baseline dei rossi al 2026-08-25: **5** in
`frontend/shared` (carosello di `test`, tribune ruotate di melbourne, decoro
paddock, e **i due dei vuoti su nuova-pista e suzuka** — che questo lavoro deve
far tornare verdi) e 8 in `backend/`, tutti preesistenti.

⚠️ **Le soglie dei vuoti si stringono, mai si allargano.** Se dopo la cura una
pista resta sopra la sua soglia, è la cura a essere insufficiente.

## Come si verifica

1. `node backend/tools/f1-costo-scenografia.js` — istanze, draw call e
   triangoli per pista, prima e dopo.
2. Le due sonde usate per questa spec: oggetti per 1000 unità di pista, e
   tratto vuoto peggiore con quota per lato.
3. `node --test frontend/shared/` e `node --test backend/`.
4. Pannello F9 in gara su `prova`.
5. Playtest: girare `nuova-pista` e `shanghai` e dire se il circuito è pieno.

## Fuori da questo lavoro

**I buchi di strutture non si chiudono qui.** Su suzuka un terzo del giro non
ha niente di costruito di fianco (quattro tratti da 475, 400, 395 e 295 unità),
e la causa non è un tetto: le infrastrutture scalano già. Il sospetto è il
raggio di non-ripetizione per contesto (`passoMinimo`), ma va **riprodotto
prima di toccarlo** ([[feedback_riprodurre_prima_di_correggere]]). Resta una
voce a sé, da aprire dopo il playtest di questa.
