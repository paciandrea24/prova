# F1 — L'editor disegna segmenti, non punti (blocco D, primo progetto)

Blocco **D** della carrellata del 2026-08-23. Il blocco come dettato conteneva
cinque progetti indipendenti; scomposti con l'utente il 2026-08-24:

- **D1+D2 — questo documento**: il modello a segmenti e l'editor per disegnarli.
- **D3** — quota e terreno: profilo altimetrico, bug delle discese.
- **D4** — banking: richiede il nastro orientato, tocca fisica e bot.
- **D5** — validatore: «controlla la pista» prima di entrare in gioco.

## Il problema

L'editor di oggi conosce una cosa sola: **il punto**. Si clicca, nasce un
punto di controllo, e il gioco ne interpola mille campioni con una Catmull-Rom.

Da lì discendono, tutte insieme, le richieste dell'utente:

- **una retta non è mai dritta**: tre punti quasi allineati danno una curva
  lenta, e per raddrizzarla si sposta un punto alla volta a occhio;
- **una curva non ha un raggio**: ha solo dei punti attorno a cui la spline
  passa. Non c'è un numero da scrivere, e non c'è modo di dire «questa è una
  parabolica da 120 metri»;
- **non si sposta un rettilineo**: si spostano i suoi punti uno per uno, e la
  forma delle curve ai due capi cambia insieme;
- **niente si può scrivere a mano**: nessuna lunghezza, nessun angolo, nessun
  raggio. Solo trascinare.

Non sono quattro difetti dell'interfaccia: sono lo stesso difetto del
**modello**. Il file contiene il RISULTATO (dove passa la pista) e non
l'INTENZIONE (cos'è quel pezzo di pista). Un'interfaccia non può restituire
un'informazione che il dato non contiene.

## Il vincolo che decide tutto

**Il gioco non cambia di una riga.** `trackLoader`, la fisica, i bot, la
scenografia, le racing line, i trigger della corsia box: tutto continua a
leggere `controlPoints`, cioè una polilinea, esattamente come oggi.

Deciso con l'utente il 2026-08-23 («l'editor resta a punti nel FILE, non
nell'interfaccia») e confermato il 2026-08-24. È il vincolo che rende questo
progetto un'aggiunta e non una riscrittura: circa 20.000 righe di logica
tarata a mano non vengono toccate.

Ne discende il secondo vincolo: **le piste esistenti non si convertono**. Non
hanno un'intenzione da cui rigenerarle — dedurla con un fitting sarebbe una
supposizione, e su `prova` (congelata, con le sue racing line ottimizzate)
sarebbe una supposizione costosa. Si aprono in modalità punti, come oggi, e
restano modificabili come oggi.

## Il modello: nodi e tratti

Un tracciato disegnato col modello nuovo è una catena chiusa di **nodi**
uniti da **tratti**.

**Il nodo** ha: posizione `x, z`; quota `y`; il flag `bridge` (entrambi già
esistono nel formato attuale); e una **direzione tangente**, cioè verso dove
punta la pista quando ci passa sopra. `dir` è un **angolo assoluto in
radianti**, con la stessa convenzione del resto del gioco
(`Math.atan2(dx, dz)`, come `TrackGeometry.tangentAt`).

Un nodo appena posato non chiede all'utente la sua direzione: la prende dalla
**bisettrice dei due vicini**, che è ciò che fa oggi la Catmull-Rom e quindi è
la forma che l'utente si aspetta di vedere. Da quel momento la direzione è un
dato del nodo e la si può girare a mano.

**Il tratto** fra due nodi consecutivi ha un tipo:

- `retta` — un segmento esatto. Impone la propria direzione alle tangenti dei
  due nodi che collega: dopo averlo dichiarato retto, resta retto.
- `curva` — passa per i due nodi rispettando la tangente di entrambi.

**La tangenza non è una cosa da mantenere: è una conseguenza.** La direzione
appartiene al NODO, e i due tratti che vi si incontrano la leggono dallo
stesso posto. Non esiste uno stato in cui due tratti adiacenti puntano in
direzioni diverse, quindi non esistono spigoli — che sarebbero
discontinuità di curvatura viste dalla fisica e dai bot, non solo brutte.

È la stessa forma della cura del blocco C: il registro della scenografia non è
una lista da aggiornare, è la conseguenza di aver posato. Qui la tangenza non
è un vincolo da controllare, è la conseguenza di avere una sola direzione per
nodo.

### Come nasce la curva

Il tratto `curva` genera i suoi punti da una **Bézier cubica** costruita sulle
due tangenti. La scelta è deliberatamente la più semplice che soddisfa i
requisiti — tangenza esatta agli estremi, nessun caso degenere, poche righe
verificabili.

⚠️ Una Bézier cubica **non ha raggio costante**: la curvatura varia lungo il
tratto. Per questo progetto va bene, perché nessuna richiesta dipende dal
raggio costante. Se in D5 (validatore) o D4 (banking) servisse la curvatura
costante — «questa curva è R=60» — il generatore si sostituisce con un
**biarco** senza toccare il modello: il tipo di tratto resta `curva`, cambia
solo la funzione che ne calcola i punti. È questa la ragione per cui il
generatore sta dietro un'interfaccia sua fin da subito.

## Il formato del file

Al `.json` si aggiunge **un campo**, `geometria`:

```json
"geometria": {
  "versione": 1,
  "nodi": [
    { "x": 36.1, "z": 128.4, "y": 0, "bridge": false, "dir": 0.0 }
  ],
  "tratti": [
    { "tipo": "retta" },
    { "tipo": "curva" }
  ]
}
```

`tratti[i]` collega `nodi[i]` a `nodi[i+1]`, e l'ultimo chiude sul primo:
la catena è chiusa per costruzione, come lo è il tracciato.

`controlPoints` **resta dov'è e non cambia significato**: viene *generato*
dalla geometria al salvataggio. La cottura scrive punti fitti — uno ogni ~5
unità di percorso — e il gioco li interpola con la stessa Catmull-Rom di
sempre. Fra punti così ravvicinati l'interpolazione non devia dalla forma
disegnata: è questa la ragione per cui il gioco non deve sapere niente.

**Quota e ponte** non hanno un modello proprio in questo progetto (il profilo
altimetrico è D3): restano attributi del nodo, come oggi lo sono del punto. La
cottura li propaga ai punti fitti interpolando la quota **linearmente** fra i
due nodi e marcando `bridge` solo i punti compresi fra due nodi che lo sono
entrambi — la stessa regola che `TrackGeometry.evalSegment` applica già oggi.
Il gioco poi ci ripassa sopra con la sua smoothstep, che fra punti a 5 unità
di distanza è indistinguibile da una retta.

**Chi possiede cosa**: `geometria` è dell'editor, `controlPoints` è del gioco.
Un file che ha entrambi si apre in modalità segmenti; un file che ha solo
`controlPoints` si apre in modalità punti. Non c'è un terzo stato.

⚠️ **Il vincolo di coerenza**: `controlPoints` è sempre il prodotto
dell'ultima cottura di `geometria`. L'editor non deve permettere di
modificare i punti cotti a mano quando la geometria esiste — sarebbero due
verità per la stessa cosa, e la seconda modifica andrebbe persa alla cottura
successiva. È lo stesso errore di [[feedback_una_cosa_una_misura]].

## Il modulo

`frontend/shared/trackSegmenti.js` — modulo **puro** (niente DOM, niente
Three.js), UMD come gli altri di `shared/`, quindi caricabile sia dal browser
sia da `node --test`. Sa fare tre cose:

- `cuoci(geometria, passo)` → l'array di `controlPoints`;
- `raddrizza(geometria, i)` → marca il tratto `i` come retta e allinea le
  tangenti dei suoi due nodi;
- misure sui tratti: lunghezza, angolo fra le due tangenti, e **raggio
  minimo** — non «il raggio», che una Bézier non ha (vedi sopra): il più
  stretto lungo il tratto, che è il numero che conta sia per chi guida sia,
  domani, per il validatore.

⚠️ **Scrivere un numero sposta un nodo, e solo quello.** Se l'utente digita
«lunghezza 140» su una retta, si sposta il nodo di ARRIVO lungo la direzione
del tratto: il nodo di partenza e tutti i precedenti restano dove sono, e il
tratto successivo si deforma di conseguenza — i nodi sono posizioni assolute,
non una catena relativa in cui una modifica trascina tutto il resto. È la
proprietà che rende il modello adatto a ricalcare un'immagine di riferimento,
che è come l'utente disegna.

Il gioco non lo carica: gli serve solo l'editor.

## L'editor

Il pannello attuale resta. Si aggiunge:

**Modalità segmenti** — una pista nuova nasce così; una vecchia resta a punti.
Si clicca per posare i nodi; si trascina la **maniglia** del nodo per girare
la tangente; il tratto selezionato mostra i suoi numeri in un riquadro, e
**quei numeri si scrivono**: lunghezza di una retta, angolo e raggio di una
curva. Un tratto si commuta fra retta e curva con un tasto.

**Snap angolare a 15°** sulla direzione delle tangenti, disattivabile tenendo
premuto Alt: è ciò che rende dritti i rettilinei paralleli senza misurare.

**Undo/redo su tutto** (Ctrl+Z / Ctrl+Y). Oggi esiste solo «annulla ultimo
punto», che non copre né lo spostamento né la cancellazione né la quota: si
sostituisce con uno storico di stati della geometria.

**Trasparenza sul TRACCIATO** invece che sull'immagine di riferimento
(richiesta esplicita dell'utente): oggi lo slider sbiadisce la foto, e per
vedere se si sta ricalcando bene bisogna sbiadire proprio il riferimento. Lo
slider passa al disegno della pista.

**Indicatore dei giri** accanto ai km: `TrackGeometry.lapsForDistance` è già
nel modulo condiviso, mancava solo mostrarlo.

**Abrasività** (richiesta dell'utente, ribadita il 2026-08-24). Il campo
`abrasivita` (0.5–2, default 1) esiste già nel `.json` ed è già letto da
`trackLoader` e usato da `TyreModel`: all'editor manca solo il controllo.
Accanto allo slider va la **previsione di quanti giri dura ciascuna mescola**.

⚠️ Quella previsione **non si ricalcola nell'editor**. `TyreModel` è un
modulo CommonJS del backend e non si carica in una pagina statica; riscrivere
la formula darebbe due numeri diversi per la stessa cosa, che è esattamente
il difetto già pagato in [[feedback_una_cosa_una_misura]]. Si aggiunge un
endpoint `GET /api/giri-per-mescola?laps=<n>&abrasivita=<a>` che risponde con
`TyreModel.giriPerMescola`, e l'editor lo interroga.

## Come si verifica

Il generatore è puro, quindi si prova senza browser
(`node --test frontend/shared/`):

- una `retta` produce punti allineati entro 1e-6;
- ai due capi di ogni tratto la direzione coincide con quella del nodo
  (tangenza), entro 1e-6;
- la catena chiude: l'ultimo tratto arriva sul primo nodo;
- il passo di cottura è rispettato: nessun intervallo oltre il passo scelto;
- **la prova che conta**: cotta una geometria e ridata in pasto a
  `TrackGeometry.sampleLoop` come fa il gioco, i 1000 campioni non si
  scostano dalla forma disegnata oltre una soglia (0.2 unità). È questa
  misura a giustificare l'intero impianto — se il gioco vedesse una forma
  diversa da quella disegnata, il modello non servirebbe a niente.

E poi l'utente in localhost: disegnare una pista con due rettilinei e due
curve, salvarla, correrci.

## Cosa resta fuori (e perché)

- **Larghezza per segmento** — il modello la regge (un campo sul tratto), ma
  la carreggiata a larghezza variabile tocca la mesh, le barriere, la ghiaia e
  la scenografia. È un progetto suo.
- **Banking** e **profilo altimetrico**: D4 e D3. La quota resta com'è oggi,
  con la rotellina sul nodo.
- **Raccordi automatici** fra tratti (la clotoide): la tangenza c'è già, il
  raccordo progressivo è un di più che nessuno ha chiesto.
- **Validatore** (D5) e **pannello a categorie**: dopo, quando i controlli
  nuovi hanno trovato il loro posto.
- **Conversione delle piste esistenti**: mai automatica. Vedi sopra.

## ⚠️ Correzione alla spec, trovata scrivendo il piano

**Due tratti retti adiacenti e non allineati sono uno stato impossibile.** Il
primo impone al nodo condiviso la propria direzione, il secondo gliene
imporrebbe un'altra: il modello dice «un nodo, una direzione», e qui ne
servirebbero due.

Non è un caso da supportare — in un circuito vero due rettilinei consecutivi
non allineati sono sempre uniti da una curva — ma è un caso da **rendere
impossibile**, non da lasciare alla disciplina di chi disegna. Quindi:
`raddrizza` converte in `curva` il tratto adiacente che perde l'allineamento
(tolleranza 0.001 rad).

Cede il tratto adiacente e non quello appena dichiarato retto, perché l'ultima
intenzione espressa è quella che l'autore sta guardando.
