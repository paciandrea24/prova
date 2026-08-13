# F1 — La scenografia segue il muro vero — Design

**Data:** 2026-08-13
**Stato:** approvato dall'utente per l'esecuzione (scelta del footbridge inclusa)

## Il problema

Tre dei difetti marcati in gioco col tasto M il 2026-08-12 restano aperti dopo
la chiusura dei grovigli di barriere (`701c53c`). Due di essi — la tribuna
storta del campione 620 e il footbridge dentro la ghiaia del campione 408 —
sono l'oggetto di questo lavoro.

Hanno **cause diverse ma una sola radice**: la scenografia è stata scritta
quando il muro stava a distanza costante dalla pista, e in alcuni punti usa
ancora quell'assunzione invece del `barrierProfile` vero.

## Causa 1 — l'orientamento viene dalla pista, non dalla barriera

`frontend/shared/trackScenery.js:712` (e identicamente
`frontend/shared/sceneryTrackside.js:69`):

```javascript
rotY: Math.atan2(p.x - x, p.z - z)
```

`p` è il punto sulla pista e `(x, z)` il punto dove sta l'oggetto: quel vettore
è la **normale della pista**. Dove il muro è a distanza costante, la normale
della pista è perpendicolare anche al nastro della barriera e il risultato è
giusto. Dove il muro sale o scende, il nastro è inclinato rispetto alla pista e
le due direzioni divergono.

**Misura (prova, 2026-08-13).** Deviazione dalla parallela alla barriera, su
149 fra tribune e reti:

| dove | elementi | storti oltre 10° |
|---|---|---|
| muro in rampa | 13 | **11** |
| muro piatto | 136 | **0** |

**Prova quantitativa della causa.** Se la causa è questa, la deviazione deve
valere `atan(Δmuro / Δpista)`. Confrontata con la deviazione misurata, la
previsione **combacia entro 3° su 146 elementi di 149**; le tre eccezioni sono
ai campioni 412-414, dove la rampa è più brusca della finestra di misura.
Dove il muro è piatto la previsione dà 0.0° e la misura ~1°.

I peggiori su `prova`: `catchFence` a 414 (37.1°), `grandStandCovered` a 615
(30.7°), `catchFence` a 616 (30.5°) e 617 (30.3°), `grandStandAwning` a 413
(26.6°). Il campione 615 è esattamente la tribuna segnalata dall'utente.

⚠️ **Il difetto è preesistente**, ma il lavoro sulle vie di fuga ne ha
aumentato il conto: la ghiaia più larga crea più rampe. Elementi storti su
`prova`: 8 a `1491be7`, 7 a `fef64f0`, **11** a `701c53c`. La regola "storto
⟺ muro in rampa" vale identica in tutti e tre.

⚠️ **`tyreStack` e `brakingBoard` non c'entrano.** Deviano fino a 79° anche
dove il muro è piatto, perché per loro il parallelismo non è la regola: un
cartello di frenata sta perpendicolare alla pista per essere letto. Vanno
esclusi da qualunque misura e da qualunque correzione, o si "aggiusta" ciò che
è già giusto.

## Causa 2 — il footbridge è dimensionato sul muro storico

`frontend/shared/sceneryLandmarks.js:47`:

```javascript
function spanScale(barrierDist, nativeHalfSpan) {
    return Math.max(1, (barrierDist + SPAN_CLEARANCE) / nativeHalfSpan);
}
```

`barrierDist` è la costante `roadHalfWidth + CURB_W + 1.2` = **15.0**, non il
muro del punto in cui il ponte viene posato.

**Misura (prova).** Il footbridge cade al campione 412, dove il muro sta a
34.5 (sinistra) e 29.8 (destra). Con `scale` 1.179 la sua semi-luce è **21.5**:
è **corto di 13.0 unità**, e i piedi atterrano dentro la banda di ghiaia, che
lì va da 13.8 a 34.5.

Lo `startGantry` usa la stessa funzione e sta bene solo per caso: è al
traguardo, dove il muro resta davvero a 15.0.

⚠️ Anche questo è preesistente e anche questo è peggiorato: prima del lavoro
di oggi la banda finiva a 29.8, ora a 34.5. Il piede era già dentro.

## Causa 3 — trovata strada facendo: il lato viene ignorato

`distanzaDalMuro` (`trackScenery.js:559`) restituisce una funzione di **due**
argomenti:

```javascript
return (idx, side) => TrackGravel.barrierAt(barrierProfile, idx, side) + margine;
```

ma `buildStandRow` la chiama con uno solo (`trackScenery.js:709`):

```javascript
const d = distanzaA(idx);
```

`side` arriva `undefined`, e `barrierAt` fa `side > 0 ? profile.right :
profile.left`: `undefined > 0` è falso, quindi **ogni tribuna prende la
distanza del muro sinistro**, anche quelle a destra.

**Misura.** Tribune il cui lato ha un muro diverso dal sinistro:

| tracciato | tribune | interessate | scarto peggiore |
|---|---|---|---|
| prova | 50 | 2 | 6.3 |
| new-monza | 65 | 4 | **14.3** |
| monte-rosso | 36 | 6 | 2.2 |
| baku | 14 | 0 | 0.0 |

Nessuna tribuna finisce dentro la linea del muro, quindi il difetto non si
vede come "tribuna murata": si vede come una tribuna troppo lontana o troppo
vicina rispetto alle vicine. **Non è fra i difetti segnalati dall'utente** — è
un extra, e sta nelle stesse righe della causa 1.

## Le correzioni

### 1. Orientamento sul nastro della barriera

Una funzione sola, condivisa dai due punti che oggi copiano la stessa riga: dà
la direzione in cui l'oggetto deve guardare perché risulti parallelo al nastro
del muro. Si ricava dalla tangente del nastro fra il campione precedente e il
successivo, non dalla normale della pista.

Dove il muro è a distanza costante la nuova formula **coincide** con la
vecchia: è la stessa direzione. È il motivo per cui il cambiamento non tocca
136 elementi su 149.

### 2. Footbridge: cerca un punto stretto, e comunque scala sul muro vero

Scelta dell'utente il 2026-08-13, fra tre alternative disegnate.

Il ciclo di ricerca del punto (`sceneryLandmarks.js:160-171`) già scarta i
tratti sopraelevati e quelli sotto un cavalcavia: si aggiunge il criterio "muro
non troppo arretrato". E `spanScale` legge comunque il muro locale invece della
costante, così se su un tracciato futuro non esistesse un punto stretto il
ponte si allunga da sé invece di finire nella ghiaia.

### 3. Il lato passato per intero

`distanzaA(idx, side)`. Una riga.

## Vincoli

- ⚠️ **La distanza dei moduli di rete non si tocca.** Oggi `catchFence` è
  posata a distanza **costante** — il massimo del muro su tre campioni — e il
  commento in `sceneryTrackside.js:155-165` dice perché: prendendo il muro sul
  campione di ciascun modulo, le reti si separavano dalla tribuna (misurate 3
  reti su 99 fino a 11.3 unità fuori posto) e finivano dentro la via di fuga
  (fino a 4.9 oltre la linea del muro). Qui si corregge **solo
  l'orientamento**. Chi tocca anche la distanza riapre un difetto già chiuso.
- **Rischio da misurare dopo il fix:** ruotando i singoli moduli di una schiera
  si possono aprire giunti fra moduli adiacenti, o farli compenetrare. Oggi le
  compenetrazioni fra moduli sono 0 e le reti staccate dalla loro tribuna 1 su
  99: sono le due invarianti da riverificare.
- **Italiano** nei commenti e nei messaggi di commit.
- **Un commit per task**, push manuale dell'utente.
- `tyreStack`, `brakingBoard`, `marshalPost` restano fuori: non sono paralleli
  al muro per costruzione.
- I **4 test rossi preesistenti** restano rossi (Simcade, i due
  `loadTrack("monte-rosso")`, `simulateLap` col preset). Il quinto rosso della
  suite cambia identità a ogni run — è flakiness da esecuzione parallela.

## Come si verifica

Le misure numeriche non bastano: tre correzioni al muro sono state approvate
sulle misure e bocciate dall'occhio dell'utente. Ogni task che tocca una forma
finisce con un disegno, e prima del playtest i disegni prima/dopo si mostrano
all'utente — è il gate che ha funzionato il 2026-08-13 sui grovigli.

**Invarianti da tenere verdi:**
- deviazione dalla parallela alla barriera: nessun elemento oltre 10°, su tutti
  e quattro i tracciati;
- compenetrazioni fra moduli di scenografia: 0;
- reti staccate dalla propria tribuna: non più di 1 su 99;
- semi-luce del footbridge ≥ muro locale su entrambi i lati;
- nessuna tribuna alla distanza del lato sbagliato.
