# F1 — numero di piloti configurabile (fino a 20) e fronte box continuo

Data: 2026-08-17 · Stato: **da approvare**

## Il problema

Oggi ogni gara ha **sei** piloti, umani più bot. Il numero non è una scelta:
è scritto a mano in tre file diversi, e ognuno lo usa per una cosa diversa.

| dove | costante | a cosa serve |
|---|---|---|
| `backend/sockets/games/f1Bot.js` | `MAX_GRID_SIZE = 6` | quanti bot creare |
| `frontend/f1.js` | `MAX_GRID_SIZE = 6` | quante piazzole dipingere sulla griglia |
| `frontend/shared/trackScenery.js` | `PLAYER_BOX_MAX_COUNT = 6` | quanto spazio riservare ai box in corsia |

Tre copie dello stesso numero che nessun test confronta: cambiarne una sola
lascia il gioco coerente a metà — la griglia dipinta per sei con dodici auto
in pista, o la scenografia che occupa lo spazio dei box.

Il secondo difetto è **il fronte della corsia box, che ha dei buchi**. Box dei
piloti ed edifici decorativi sono due sistemi separati che si evitano a
vicenda: la scenografia esclude la zona dei box, e i box si posano dove
capita. Il risultato misurato:

- su **monte-rosso** i sei box più il loro grembiule occupano tutti i 233
  campioni utili di una corsia lunga 368, e gli edifici decorativi scendono a
  **zero**;
- con **pochi piloti** succede il contrario: i box occupano poco e il resto
  della corsia resta vuoto, perché lo spazio è comunque riservato al caso
  peggiore.

Richiesta esplicita dell'utente: **niente buchi, nemmeno con un pilota solo.**

## Cosa si ottiene

- Il numero di piloti si sceglie **in lobby**, a scaglioni, fino a **20**.
- Il fronte della corsia box è **continuo** a qualunque numero di piloti: box
  dove ci sono i piloti, edifici decorativi per tutto il resto della corsia.
- La classifica a schermo resta **completa** (scelta dell'utente; se risulterà
  ingombrante si taglierà dopo, non ora).

## Il perno del progetto

**Il client conosce il numero di piloti PRIMA di generare la scenografia.**

È il fatto che rende semplice tutto il resto, e oggi non è sfruttato. Le
impostazioni della lobby viaggiano già nell'indirizzo della pagina di gioco
(`f1.html?...&settings=...`, vedi `lobby.js`) e `f1.js` le legge in
`clientSettings` come prima cosa, prima di `TrackScenery.generateLayout`.
Quindi la scenografia può essere generata **per il numero reale** invece che
per il caso peggiore, e il commento in `trackScenery.js` che dichiara
l'impossibilità («PRIMA di sapere quanti giocatori parteciperanno davvero»)
smette di valere.

Da qui discende che il numero di piloti diventa **un dato di partita**, non
una costante: nasce in lobby, il server lo usa per creare i bot, il client per
dipingere la griglia e per costruire il fronte della corsia.

## Progetto

### 1. Un numero solo, con una fonte sola

Nuovo campo `gridSize` nelle impostazioni F1 della lobby (accanto a `trackId`
e `botsEnabled`), con scaglioni **6 / 10 / 14 / 20**.

- **Server**: `createBots` riempie fino a `gridSize` invece che a
  `MAX_GRID_SIZE`. `MAX_GRID_SIZE` resta come **tetto assoluto** (20), non più
  come dimensione della griglia.
- **Client**: `f1.js` legge `clientSettings.gridSize` e lo passa sia a
  `buildStartingGrid` sia a `TrackScenery.generateLayout`.
- **Test**: un test verifica che le tre costanti non tornino a divergere —
  cioè che griglia dipinta, box riservati e bot creati vengano tutti dallo
  stesso valore.

`botsEnabled = false` continua a significare «nessun bot»: `gridSize` diventa
allora il numero di posti, non di piloti.

### 2. Il tetto vero lo decide la pista

Una corsia box lunga L con passo P regge `floor(L / P)` box. Misurato oggi
(P = 24):

| tracciato | corsia box | box possibili |
|---|---|---|
| monte-rosso | 202 | 8 |
| new-monza | 268 | 11 |
| prova | 512 | 21 |

Due mosse insieme:

- **Il passo scende da 24 a 15 unità** (≈11,7 m, la larghezza di un box vero;
  oggi sono garage da 21,8 unità per un'auto larga 3,47). Il modello `pitBox`
  va rigenerato più stretto — è generato da script
  (`backend/tools/circuitAssets/pitBox.py`), quindi la modifica è nel builder,
  non nel `.glb`. Capienza risultante: monte-rosso 13, new-monza 17, prova 34.
- **La lobby mostra gli scaglioni oltre la capienza come disabilitati**, con
  il motivo scritto («la corsia box di monte-rosso regge 13 piloti»), invece
  di farli sparire. L'utente costruisce piste con corsie lunghe: la capienza
  cresce da sé, senza altre modifiche.

⚠️ `PIT_BOX_SPACING` è **condiviso con l'autopilota server-side**: determina
dove le auto si fermano davvero. Cambiarlo richiede un playtest della sosta,
non solo un controllo a vista.

### 3. Il fronte della corsia diventa una fila sola

È la parte che elimina i buchi, e cambia un'idea di fondo: oggi box e edifici
si escludono a vicenda, domani **si alternano nella stessa fila**.

```
corsia box, dall'ingresso all'uscita, passo costante:

  [box P1][box P2][box P3][edificio][edificio][edificio][edificio]
   \_____ tanti quanti i piloti _____/\____ tutto il resto ____/
```

Una funzione sola cammina la corsia a passo `PIT_BOX_SPACING` e per ogni
posizione decide: box di un pilota (se ne restano) oppure edificio
decorativo. Ne discende che:

- con **un pilota** c'è un box e tutto il resto è edifici — nessun vuoto;
- con **venti** ci sono venti box e il resto edifici — nessun vuoto;
- il caso monte-rosso (edifici a zero) non è più possibile per costruzione:
  gli edifici occupano *esattamente* ciò che i box non usano.

Gli edifici disponibili sono quelli già in catalogo (`pitsGarageClosed`,
`pitsOffice`), che hanno la stessa profondità dei box e stanno sulla stessa
linea di fronte (`PIT_BUILDING_OFFSET_MARGIN` è già allineato a
`PIT_BOX_OFFSET_MARGIN`, vedi `docs/f1-notes.md`).

### 4. La classifica

Resta completa, con tutti i piloti. Cambia solo che il pannello diventa
scorrevole oltre una certa altezza, per non uscire dallo schermo su una
finestra bassa. Nessun taglio dei contenuti: è una scelta esplicita
dell'utente, rivedibile dopo il playtest.

## Come si verifica

Il difetto dei buchi è geometrico, quindi si misura senza aprire il gioco:

- **niente buchi**, un test per tracciato × 1 / 6 / 14 / 20 piloti: camminando
  la corsia box non esiste un tratto più lungo di `PIT_BOX_SPACING` senza né
  un box né un edificio davanti;
- **niente sovrapposizioni**: due elementi consecutivi del fronte non si
  compenetrano (SAT, come già fa `SceneryAssetSizes.itemsOverlap`);
- **una fonte sola**: bot creati, piazzole dipinte e box riservati vengono
  tutti dallo stesso numero;
- **capienza**: il tetto offerto dalla lobby non supera mai `floor(L / P)`
  della pista scelta.

Restano da playtestare, perché nessun test li vede: la **sosta ai box** col
passo nuovo (l'autopilota si ferma su quella misura) e l'**aspetto del fronte
continuo**, che è una scelta estetica.

## Fuori da questo lavoro

- Costo di rendering con 20 auto: misurato in anticipo (+220 draw call, +201k
  triangoli su ~800 e 1698k della scenografia; il gioco è limitato dai pixel,
  non dalle draw call). Si verifica col pannello F9 al playtest, non si
  ottimizza in anticipo.
- Il costo lato server è già stato escluso: 0,65 ms per tick con 20 auto su un
  budget di 50.
- Box su due file: scartato, l'autopilota dovrebbe imparare a servire due file
  ed è codice che ha già dato problemi.
