# F1 Bot — Fase 1: cervello di guida unificato, gap dall'umano, ingresso box, generalizzazione

## Contesto

Il bot IA di F1 ha accumulato negli ultimi mesi diversi miglioramenti validati
ma tenuti dietro flag sperimentali mai promossi a default (grip-awareness,
lookahead adattivo alla curvatura — vedi
`docs/superpowers/specs/2026-07-28-f1-bot-grip-awareness-design.md` e
`docs/superpowers/specs/2026-07-29-f1-bot-adaptive-pursuit-controller-design.md`).
Nel frattempo, la racing line ottimale per pista viene calcolata offline da
`backend/tools/f1RaceLineOptimizer.js`, che minimizza il tempo sul giro con la
fisica esatta del gioco — ma lo fa simulando un bot con una **copia separata e
più vecchia** della logica di guida (`simulateWithRacingLine`): niente
grip-awareness, lookahead sempre a tempo fisso. Le due implementazioni si sono
scollegate nel tempo: ogni miglioramento al bot che corre davvero non si
riflette in ciò che l'ottimizzatore considera "la linea migliore".

Ipotesi di lavoro, motivata da questo disallineamento: è la causa più
probabile di tre problemi osservati e mai chiusi —
1. la racing line calcolata non è mai risultata una vera fuori-dentro-fuori
   (misurato in audit precedenti, vedi memoria di progetto);
2. il bot resta 3-4 secondi/giro più lento di un umano forte, gap accettato
   in passato ma ora da chiudere del tutto;
3. il bot non entra fisicamente ai box su monte-rosso/prova (causa isolata:
   la transizione verso la corsia box è una logica a parte, tarata a
   sensazione su una sola pista, non condivisa con il resto del sistema di
   guida).

Decisione presa con l'utente: NON patchare i tre problemi singolarmente
(pattern già tentato più volte, mai risolutivo — vedi
`feedback_bot_ai_physics_over_heuristics`). Si unifica il cervello di guida
alla fonte.

## Obiettivo di questa fase

Un bot che guida **da solo** al limite fisico dell'auto, su **qualsiasi
pista** creata con l'editor (esistente o futura), con un gap dall'umano
azzerato al punto da poter vincere una gara. Include la correzione
dell'ingresso ai box, trattato come lo stesso problema (seguire bene una
traiettoria anche in una geometria "scomoda"), non come bug isolato.

**Fuori scope per questa fase** (rimandato):
- Comportamento con altre auto in pista (sorpassi/difesa/incidenti di
  gruppo) — Fase 2, sessione successiva.
- Il ramo di guida "di ripiego" per piste senza racing line precalcolata
  (calcolo geometrico a runtime) — resta come oggi; l'utente ha confermato
  che il passaggio manuale (lanciare l'ottimizzatore dopo aver creato una
  pista) va bene, purché il risultato finale sia ottimo.
- Il lavoro sui box-garage visivi (worktree `f1-pit-boxes`, feature
  scenografica indipendente).

## 1. Cervello di guida condiviso

Si estrae dal ramo "racing line" di `updateBotInputs` (`f1Bot.js`) la parte
pura che decide sterzo/target di velocità per guidare al meglio **da solo**
su una linea — nessuna dipendenza da altri giocatori, pit stop, socket.
Diventa una funzione dedicata, riusata identica da:
- `f1Bot.js::updateBotInputs` (bot che corre davvero): la usa per il
  comportamento di base, poi ci sovrappone come oggi le decisioni
  race-only (scia, sorpasso/following, ingresso box — vedi punto 4).
- `backend/tools/f1RaceLineOptimizer.js::simulateWithRacingLine`: la chiama
  al posto della propria copia interna, per valutare quanto è veloce una
  candidata di linea usando lo **stesso identico bot** che poi corre in
  gara — non più un'approssimazione.

Grip-awareness e lookahead adattivo (oggi dietro `F1_BOT_GRIP_AWARENESS` e
`F1_BOT_ADAPTIVE_LOOKAHEAD`, entrambi validati singolarmente ma mai accesi in
gara) diventano comportamento permanente e incondizionato ovunque siano già
collegati oggi — quindi anche nel ramo geometrico di ripiego, che li
consulta già dietro lo stesso flag. L'estrazione del cervello condiviso
(la funzione riusata anche dall'ottimizzatore) riguarda invece solo il ramo
racing-line: è l'unico dei due che l'ottimizzatore deve poter simulare,
perché il ramo di ripiego non produce mai un file `-raceline.json`. Il ramo
di ripiego perde quindi il flag (diventa sempre grip-aware/adattivo) ma
resta altrimenti la logica geometrica a runtime di oggi, non toccata
dall'estrazione.

## 2. Racing line ricalcolate col cervello vero

Dopo l'unificazione, si rilancia l'ottimizzatore su tutte le piste esistenti
(`new-monza`, `monte-rosso`, `prova`, `baku`), sovrascrivendo i file
`-raceline.json`. Si adotta come punto di partenza il seed "shape-prior"
(fuori-dentro-fuori geometrico) già prototipato nel file ma non ancora
promosso a percorso di default — riduce il rischio che la ricerca si areni
su un ottimo locale mediocre partendo da zero.

Verifica: confronto del tempo sul giro con `f1LapSimulator.js` prima/dopo su
ogni pista — non deve mai peggiorare.

## 3. Chiusura del gap dall'umano

Metodo: si registra manualmente un giro umano veloce reale per pista (un
buon giro di qualifica giocato in locale, tempo letto dall'interfaccia di
gioco), usato come riferimento fisso. Dopo l'unificazione e il ricalcolo del
punto 2, si confronta il tempo del bot più forte (via `f1LapSimulator.js`,
fisica esatta, nessuna differenza rispetto al tempo reale in gara a parte il
jitter già noto e documentato in `docs/f1-notes.md`) contro quel riferimento,
pista per pista.

Se il bot resta più lento: si alzano i margini di aggressività già esistenti
(`cornerSpeedMargin`, `brakingDistanceMargin`, moltiplicatori di ritmo),
**un valore alla volta, verificato via simulazione headless** (nessun
DNF/testacoda su nessuna pista prima di accettare il valore) — mai a
sensazione, per non ripetere l'errore già registrato in passato su questo
stesso bot. Obiettivo: sulla pista dove il bot è più forte, il tempo deve
pareggiare o battere il riferimento umano, non solo avvicinarsi.

## 4. Ingresso ai box come parte della stessa traiettoria

Causa nota (misurata): l'ingresso ai box usa oggi una curva di transizione a
forma fissa (cubica, tarata a sensazione su New Monza) che sposta
gradualmente il bersaglio del bot verso il punto di raccordo della corsia
box in una finestra di distanza fissa. Su monte-rosso/prova il raccordo è
geometricamente più brusco: la stessa forma fissa non fa convergere l'auto
in tempo dentro il rettangolo-trigger d'ingresso, e il bot gira per tutta la
gara senza mai pittare.

Fix: la velocità di convergenza verso il punto di raccordo si deriva dalla
geometria reale locale di ciascuna pista (distanza laterale e curvatura tra
linea principale e corsia box vicino al punto d'ingresso), stessa filosofia
già usata per il lookahead adattivo — non una forma unica tarata su una sola
pista. Riusa gli stessi strumenti geometrici del cervello condiviso (punto
1) invece di restare una logica a parte.

Verifica: script di riproduzione headless già esistente (`tickGame` in
loop, soglia usura forzata bassa) su tutte le piste, incluse quelle nuove
del punto 5 — il bot deve completare fisicamente il pit stop su ognuna.

## 5. Prova di generalizzazione

Si creano 2-3 piste nuove, deliberatamente pensate per rompere le
assunzioni attuali: un tornante molto stretto, una coppia di chicane in
rapida sequenza, un imbocco ai box che si stacca dalla linea principale con
un angolo molto più marcato di quanto visto oggi. "Funziona su qualsiasi
pista" si considera dimostrato solo se il bot (traiettoria, velocità,
ingresso ai box) si comporta bene anche su queste piste mai usate per
calibrare alcun numero — non solo sulle 4 piste esistenti.

## Cosa cambia nei test esistenti

I test in `f1Bot.test.js` che verificano "a flag spento il comportamento è
identico a prima" (adaptive lookahead, grip-awareness) diventano obsoleti:
il comportamento "di prima" non è più quello a cui tornare, quel ramo
legacy viene rimosso insieme al flag. Vanno aggiornati per testare il nuovo
comportamento permanente, non la parità col vecchio.

## Testing

- Unit test sulla funzione di guida condivisa (stesso stile di
  `f1Bot.test.js` esistente): stessi input → stesso output in
  `f1Bot.js`/`f1RaceLineOptimizer.js` (nessuna doppia implementazione
  residua).
- Regressione completa `node --test` su tutta la suite, incluso
  `f1LapSimulator.test.js` e `f1GameSocket.physics.test.js`.
- `f1LapSimulator.js` e riproduzione headless del pit-entry su tutte le
  piste (le 4 esistenti + le 2-3 di stress test del punto 5): nessun
  DNF/testacoda, ingresso ai box confermato ovunque.
- Confronto tempi bot vs riferimento umano registrato (punto 3), pista per
  pista.
- Playtest finale dell'utente in localhost (almeno 2 tab) prima di
  considerare la fase chiusa — coerente con la convenzione di progetto di
  verificare ogni step prima di proseguire.
