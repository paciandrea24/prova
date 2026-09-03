# Le barriere: cartelloni veri e gomme che fermano l'auto — design

**Data:** 2026-09-04
**Blocco:** G, ultima voce — «barriere con sponsor» della carrellata del 23-08.
**Supera** la soluzione del 2026-08-27 (`6c7e58b`, `50db0e9`).

## Perché una seconda stesura

Il giudizio dell'utente sul lavoro del 27-08:

> «a me la soluzione trovata per le barriere con pubblicità non mi piace. ha
> semplicemente cambiato il colore. e questo si applica solo ai circuiti
> cittadini»

Ed è esatto. Oggi la barriera è lo **stesso muro estruso** di sempre, colorato a
fasce col vertex color — fondo, banda chiara, fondo. Nessun cartellone, nessun
marchio, nessuna geometria: a 250 km/h si legge «muro colorato». E il ramo si
accende solo con l'ambientazione città, mentre nella F1 vera gli sponsor a bordo
pista ci sono ovunque, Monza e Spa comprese.

## Cosa c'è già, e non va rifatto

- **`tyreStack.glb`** (7 × 1.9 × 2.4) esiste, ed è **già posato in fila lungo
  tutto l'arco esterno di ogni curva** da `sceneryTrackside.js`, categoria
  `safety`, passo 7. Sta a `barrierDist + 2.5`, cioè **oltre** il muro: dietro,
  invisibile. Non va creato niente — va spostato davanti, e va fatto contare.
- **`findCorners`** conosce curve e lato esterno, ed è la stessa funzione che
  decide dove va la ghiaia.
- **`Palette.CITTA_SPONSOR`**: sei combinazioni fondo/banda già scelte.
- **`barrierProfile`**: la distanza del muro per campione e lato, fonte unica
  per fisica, mesh, ghiaia e scenografia.

## Le decisioni dell'utente (non ridiscutere)

1. **Scritte inventate leggibili** sui pannelli, non forme astratte.
2. **Le gomme fermano l'auto dove stanno**: la via di fuga si accorcia.
3. **Nascono all'esterno delle curve, in automatico** — nessun interruttore
   nell'editor.
4. **Valgono su tutte le piste, `prova` compresa.** Una barriera non è
   scenografia cotta: fa parte del tracciato.
5. **Nastro separato** per i cartelloni, non texture spalmata sul muro: serve
   poter dire *qui sì e qui no*.
6. **Molti sponsor**, per avere varietà.

## Il vincolo che detta la regola delle gomme

Misurato il 2026-09-04 su tutte e dodici le piste in cartella, larghezza della
via di fuga (`barrierProfile − roadHalfWidth`):

| pista | minimo | mediana | quanto giro sotto le 5 unità |
|---|---|---|---|
| melbourne | 4.0 | 18.8 | 19% |
| suzuka | 2.0 | 18.8 | 28% |
| prova | 2.0 | 18.8 | 30% |
| monte-rosso | 4.0 | 18.8 | 31% |
| **citta-prova** | **4.0** | **4.8** | **100%** |

Due regimi: dove c'è ghiaia la via di fuga è larga 18.8, ma **in un quinto o un
terzo del giro è larga 4**, e in città lo è ovunque per scelta (il muro sta
attaccato al cordolo, deciso il 27-08).

Una fila di gomme è profonda 2.4. Dove la via di fuga è 18.8 toglie il 13% ed è
giusto così; dove è 4.0 lascerebbe **1.6 unità fra cordolo e impatto**, cioè un
muro praticamente sul cordolo.

⚠️ Quindi la regola non è «all'esterno delle curve», è **all'esterno delle curve
dove c'è spazio**. È anche ciò che si vede in pista vera: dove lo spazio manca
c'è il guard-rail attaccato, le gomme stanno in fondo alla ghiaia.

## 1. Le gomme

- Nascono sull'arco esterno di ogni curva (`findCorners`), **solo dove la via di
  fuga supera `FUGA_MINIMA_GOMME`**. Valore di partenza **8 unità**: sopra, il
  cuscinetto lascia comunque più spazio di quanto ne abbia oggi un tratto
  stretto. Da confermare misurando quanta parte di ciascuna curva sopravvive
  alla soglia — se su una pista sparissero del tutto, si abbassa una volta e si
  rimisura, ma non sotto le 6: a 6 restano 3.6 unità di fuga, meno di un
  cordolo.
- Dove ci sono, **il punto d'impatto avanza di `PROFONDITA_GOMME = 2.4`** verso
  la pista: si sbatte sulle gomme, non sul muro.
- Le istanze visive si posano **a quella distanza**, non più a
  `barrierDist + 2.5`: la fila che si vede è la fila che ferma.
- Passo 7 come oggi. ⚠️ Il modello è largo 7.0 e il passo è 7: in curva stretta
  le pile si compenetrano di poco sul lato interno — accettabile fra volumi
  identici, come già deciso per le fette del palazzo, ma va misurato lo scarto
  peggiore e dichiarato.

## 2. Il numero che si sdoppia

`barrierProfile` restituisce oggi `{left, right}`. Diventa:

- **`left` / `right` = dove si sbatte.** Invariato dove non ci sono gomme,
  ridotto di `PROFONDITA_GOMME` dove ci sono. Chi già li legge per la
  **collisione** non cambia una riga, ed è il caso della fisica del server.
- **`muroLeft` / `muroRight` = dov'è il muro.** Il profilo di oggi, sempre.

Chi legge cosa:

| consumatore | legge |
|---|---|
| fisica del server (collisione con la barriera) | dove si sbatte |
| ghiaia (`gravelProfile`) | dove si sbatte — la ghiaia arriva alle gomme |
| mesh del muro (`trackMeshBuilder`) | dov'è il muro |
| nastro dei cartelloni | dov'è il muro |
| scenografia (traslazione, `distanzaDalMuro`) | dov'è il muro |
| gomme (posa delle istanze) | dove si sbatte |

⚠️ **È qui il rischio vero del lavoro.** Un consumatore che legge il numero
sbagliato mette gli oggetti dentro le gomme o disegna il muro dove passa l'auto.
Il piano deve passare in rassegna **tutti** i chiamanti di `barrierProfile`,
nominandoli uno per uno, e un test deve fissare la relazione: dove ci sono
gomme, `muro − impatto == PROFONDITA_GOMME`; dove non ci sono, i due profili
coincidono.

## 3. Il nastro dei cartelloni

- Una fascia estrusa lungo il muro, **alta 1.6**, posata **sopra** il muretto
  (che è alto 1.1): il fronte arriva a 2.7 complessive, la proporzione dei
  muretti pubblicitari veri. ⚠️ **Sopra e non davanti**: davanti ruberebbe altre
  unità alla via di fuga, che il paragrafo precedente ha appena mostrato essere
  stretta in un terzo del giro.
- **Dove nasce**: ovunque il muro non abbia le gomme davanti, più sempre il
  tratto traguardo/box. Curve con gomme → muro nudo dietro le gomme; rettilinei
  e zona pubblico → cartelloni.
- Una sola mesh, un solo materiale, un solo draw call, come il muro.
- ⚠️ **UV dalla distanza percorsa**, non dall'indice del campione:
  `u = distanza lungo il nastro / LUNGHEZZA_PANNELLO`. Così il passo dei
  pannelli resta costante anche in curva, dove il bordo esterno è più lungo
  dell'asse. Con l'indice, le scritte si stirerebbero in curva e si
  stringerebbero dove i campioni sono fitti.

## 4. Gli sponsor

**Venti pannelli**, nome inventato su fondo colorato con banda. I nomi non
devono essere riconducibili a marchi esistenti, né esserne parodie riconoscibili
(niente storpiature di marchi F1 veri):

```
VELOCE   AEROTEC   NOVARIS   KILOVOLT   FULMINE
ORBITEC  VERTICE   LAMPO     CRONOMAX   TURBINA
ASSOLUTA QUADRANTE IPERION   MERIDIA    VOLTARIS
ALTAVIA  BOREALE   ZEFIRO    PRIMATO    CIRRO
```

Disegnati a runtime in una `CanvasTexture` come atlante orizzontale: venti
pannelli affiancati, ciascuno fondo + scritta + banda, tinte da
`Palette.CITTA_SPONSOR`. La sequenza lungo il giro è pseudocasuale con seme
derivato dall'id della pista, come già fa il resto della scenografia: la stessa
pista mostra sempre gli stessi cartelloni negli stessi punti.

⚠️ Il testo va disegnato **netto**, senza antialiasing spinto: in cel shading
una scritta sfumata diventa una macchia grigia. Vale la lezione delle finestre
delle facciate, che come vertex color sembravano tende a coste.

## 5. I colori

- Il muretto diventa **cemento chiaro** ovunque: è ciò che si vede in F1 sotto i
  cartelloni.
- I **cordoli restano bianco-rossi**, che è il loro posto.
- Il bianco-rosso sopravvive sul muro solo dove non c'è né cartellone né gomme —
  le zone di servizio.
- In città sparisce la colorazione a fasce del 27-08, sostituita dai cartelloni
  veri. Il ramo `sponsor` di `trackMeshBuilder` e l'uso di
  `Palette.CITTA_SPONSOR` come tinte del muro vengono **rimossi**: le tinte
  restano, ma servono ai pannelli.

⚠️ È il cambiamento più visibile del lavoro: **ogni pista cambia colpo
d'occhio**, non solo le cittadine.

## Invarianti e test

Su **ogni** pista della cartella:

1. **Dove ci sono gomme, si sbatte prima**: `muro − impatto == PROFONDITA_GOMME`
   entro un millesimo; dove non ce ne sono, i due profili coincidono.
2. **Le gomme non entrano in pista**: ogni istanza sta almeno mezza carreggiata
   più il cordolo lontano dall'asse.
3. **La via di fuga non scende sotto le 5 unità** in nessun punto per colpa
   delle gomme.
4. **Le gomme stanno dove si sbatte**: la distanza fra l'istanza e il profilo
   d'impatto è mezza profondità del modello, non 2.5 oltre il muro.
5. **Nessun cartellone davanti alle gomme**, e nessun tratto con entrambi.
6. **Il nastro non ha buchi** dove il muro è continuo, e ne ha dove il muro si
   apre (corsia box, tratti acrobatici).
7. **I pannelli hanno passo costante**: la lunghezza in mondo di un pannello non
   varia di più del 5% fra rettilineo e curva stretta.
8. **La scenografia non finisce dentro le gomme**: nessun oggetto fra il profilo
   d'impatto e il muro.

## Cosa NON si fa

- Niente sponsor scelti per pista, niente interruttore nell'editor (il blocco F
  è scartato).
- Niente marchi reali, e niente parodie riconoscibili.
- Niente barriere Tecpro, niente guard-rail metallici: un solo tipo di
  cuscinetto, le gomme.
- Niente pannelli sulle reti di protezione o sulle tribune.

## Rischi dichiarati

1. **Le traiettorie dei bot.** La via di fuga si accorcia all'esterno delle
   curve, che è esattamente dove i bot tagliano: le racing line vanno riprovate,
   e `prova` è la pista su cui l'utente gioca. Va misurato il giro dei bot prima
   e dopo, non solo guardato.
2. **`prova` è congelata** sulla scenografia cotta: la fila di gomme **visiva**
   viene dalla scenografia, quindi lì resterebbe quella vecchia finché non si
   ricuoce — mentre il profilo d'impatto cambia subito. Si sbatterebbe su gomme
   che si vedono altrove. **La ricottura di `prova` fa parte di questo lavoro,
   non è opzionale.**
3. **Il costo dei pixel.** Un nastro alto 1.6 lungo tutto il giro è poca
   geometria ma molti pixel vicini alla camera, e il progetto è GPU-bound sui
   pixel. Pannello F9 prima e dopo.
