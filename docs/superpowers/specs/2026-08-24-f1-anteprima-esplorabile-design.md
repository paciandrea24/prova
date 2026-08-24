# F1 — L'anteprima esplorabile (blocco E)

Blocco **E** della carrellata del 2026-08-23, aperto il 2026-08-24 subito dopo
il primo progetto dell'editor ([[project_f1_editor_segmenti]]).

## Il problema

L'editor ora disegna piste per bene, ma per **giudicarle** bisogna ancora
avviare una gara: scegliere una lobby, aspettare il caricamento, correre fino
al punto che si vuole guardare. Per una domanda come «quel palazzo è troppo
vicino alla curva?» è un giro di due minuti, e l'utente ne fa decine.

Dettato dall'utente: «io creo il circuito e poi tramite un tasto posso entrare
effettivamente in gioco e vedere tutto. mi interessa capire la disposizione
degli edifici lungo la pista, se ci sono problemi che posso risolvere
semplicemente spostando di poco i punti del tracciato. mi devo poter muovere
liberamente lungo la mappa, volare in giro. non serve renderizzare macchine.
non serve neanche renderizzare luci, ombre o contorni. solo gli asset
effettivi che troverò in gioco.»

## Il vincolo che decide tutto

**L'anteprima non deve poter divergere dal gioco.** Un'anteprima fedele al 95%
è peggio di nessuna anteprima: si prendono decisioni guardando una pista che
in gara non esiste, e il difetto si scopre più tardi e più lontano.

Oggi la scena di gioco **non è costruita da una funzione riusabile**: è una
sequenza di quindici chiamate a `TrackMeshBuilder` sparse in `frontend/f1.js`
fra la riga 490 e la 710, con quattordici parametri calcolati lì in mezzo
(mezza carreggiata, cordoli, profilo delle barriere, pianoro del terrapieno,
ghiaia rifilata, corsia box agganciata…). Ricostruirla altrove significa
copiarla, e una copia diverge: è già successo tre volte in questo progetto —
l'ingombro finto degli asset, il cono del traguardo specchiato, la formula
delle gomme che stava per essere riscritta nell'editor.

Quindi: **si estrae, non si duplica**.

## L'impianto

### 1. `frontend/shared/f1Scena.js` — la scena, una volta sola

Una funzione `costruisciCircuito(scene, trackData, opzioni)` che:

- calcola i parametri derivati (oggi righe 490-593 di `f1.js`);
- chiama `TrackMeshBuilder` nella sequenza esatta di oggi: terreno,
  terrapieno, cavalcavia, asfalto, cordoli, ghiaia, barriere, linea del
  traguardo, corsia box, griglia di partenza;
- **restituisce** ciò che serve a chi la chiama: `trackPts`, `groundPts`,
  `pitPts`, `barrierProfile`, `embankPlateau`, `embankOuter`,
  `startFinishIndex`, e le mesh del prato (che `f1.js` converte a parte).

`f1.js` la usa al posto delle sue righe; l'anteprima la usa identica. La
fedeltà non è più una disciplina da mantenere: è una conseguenza.

⚠️ **La barra di caricamento resta fuori.** Oggi fra un blocco e l'altro
`f1.js` chiama `caricamento.passo()` e `await caricamento.respira()` — servono
a non bloccare il thread per secondi. La funzione estratta li riceve come
callback opzionale (`opzioni.passo`), così il gioco continua a mostrare la
barra e l'anteprima non ha bisogno di averne una.

⚠️ **Lo stile cel-shaded resta fuori.** Comincia dopo `buildStartingGrid` ed è
esattamente ciò che l'anteprima non vuole. Il confine dell'estrazione è lì.

### 2. `frontend/shared/sceneryAssetPaths.js` — dove stanno gli asset

La tabella `SCENERY_ASSET_PATHS` (55 voci) oggi vive dentro `f1.js`. È l'altra
cosa che non deve esistere in due copie: se l'anteprima avesse la sua, un
asset nuovo comparirebbe in gara e non in anteprima — o peggio, con un modello
diverso.

### 3. `frontend/track-preview.html` — la vista

Pagina propria, non una modalità di `f1.html`: il gioco si collega al socket
alla riga 159 e ha quarantacinque punti che dipendono dalla partita.
Attraversarli con un flag «non giocare» sarebbe più rischioso per il gioco che
scrivere una pagina nuova.

Contiene: la scena costruita col punto 1, gli asset caricati secondo il layout
di `TrackScenery.generateLayout` (lo stesso identico che usa la gara), e una
**camera libera**.

- **WASD** per muoversi nel piano dello sguardo, **Q/E** per scendere e salire,
  **mouse** per guardarsi intorno (pointer lock), **Shift** per correre.
- Nessuna auto, nessuna luce direzionale, nessuna ombra, nessun contorno toon:
  una luce ambientale piatta e i materiali come escono dai `.glb`.
- Si parte **sul traguardo, a quota d'uomo**, guardando nel verso di marcia:
  è il punto da cui si giudica una pista.

### 4. Il ponte fra editor e anteprima

Un tasto **Esplora** nell'editor. La pista in lavorazione passa
dall'editor all'anteprima in `sessionStorage` (stessa origine, nessun
salvataggio necessario): si può guardare una pista **non ancora salvata**, che
è il caso normale mentre la si disegna. Un tasto **Torna all'editor**
riporta indietro.

⚠️ Nessuna modifica viaggia nel verso opposto: l'anteprima **guarda**, non
tocca. Il ritocco degli asset è il blocco F, e avrà bisogno di questa vista
per esistere — ma è un progetto suo.

## Come si verifica

**Il test che conta** è di caratterizzazione: `costruisciCircuito` riceve un
`TrackMeshBuilder` finto che registra ogni chiamata con i suoi argomenti, e il
test confronta la sequenza con quella attesa — le dieci chiamate nell'ordine
di oggi, coi parametri di oggi, su ognuna delle piste esistenti. Se qualcuno
domani cambia l'ordine (i cordoli vanno dopo l'asfalto, il profilo barriere
prima del terreno) o un parametro, il test lo dice prima che lo dica una gara.

Poi, a occhio: la scena dell'anteprima e quella della gara devono avere lo
stesso numero di mesh e la stessa impronta a terra.

## Cosa resta fuori

- **Ritocco degli asset** (togli questo, sposta quello): blocco F.
- **Auto, luci, ombre, contorni**: esclusi per richiesta esplicita, e sono
  anche ciò che rende l'anteprima leggera.
- **Il minimap e l'HUD** della gara.
- **La camera in prima persona dei tratti rovesciati**: serve al giro della
  morte, che viene dopo il banking.
