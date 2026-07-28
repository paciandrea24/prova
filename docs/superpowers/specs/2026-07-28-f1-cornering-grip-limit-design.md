# F1 — Fase 4: limite di aderenza laterale in curva — Design

**Contesto:** l'architettura fisica modulare (`backend/sockets/games/physics/`)
copre oggi trazione, frenata e aderenza in curva SOLO come fattori dipendenti
dall'usura gomme (`TyreForceModel.corneringGripFactor`), applicati a un
blend istantaneo velocità-verso-direzione-muso a rate costante
(`AerodynamicsModel.applyGripBlend`). Non esiste alcuna dipendenza da
velocità o intensità di sterzo: lo stesso ingresso di sterzo produce lo
stesso comportamento di "aggancio" a 50 km/h e a 300 km/h, a parità di
usura. Fase 3 (`TyreSlipModel.js`) ha già introdotto per trazione e frenata
il concetto di domanda-vs-capacità con eccesso ed (per la sola trazione) un
debito persistente, dopo aver verificato in playtest che un effetto
puramente istantaneo si percepisce come "motore debole", non come perdita
di aderenza reale.

**Obiettivo di questa fase:** applicare lo stesso concetto (domanda vs
capacità disponibile) all'asse laterale, così che sterzo+velocità eccessivi
rispetto alla capacità disponibile producano una perdita di aderenza
progressiva invece del blend a rate fisso di oggi.

## Nota terminologica (vincolante)

Questo NON è un modello di slip angle fisico. Un vero slip angle
richiederebbe la dinamica di imbardata (yaw), la direzione reale della
velocità del veicolo scomposta per asse, e una curva di forza laterale in
funzione dell'angolo — tutta dinamica assente oggi dal motore fisico e
esplicitamente fuori scope. Quello che si progetta qui è un **modello di
perdita di capacità laterale**: una riduzione del grip-blend esistente,
guidata da un rapporto domanda/capacità dello stesso tipo già usato per
trazione e frenata, che produce un comportamento *equivalente percepibile*
(l'auto non punta più così in fretta dove indica il muso, se stai chiedendo
più aderenza di quanta ce ne sia). In tutto il documento si parla di
"domanda/capacità/eccesso laterale", mai di "slip angle".

## 1. Comportamento che deve emergere

- Entro il limite di aderenza disponibile: **nessun cambiamento** rispetto
  al comportamento odierno.
- Oltre il limite: perdita di aderenza **progressiva e continua** (mai un
  salto di stato), proporzionale a quanto la domanda eccede la capacità.
- Gomma usurata: il limite si raggiunge prima (a parità di sterzo e
  velocità) — stessa logica già presente per trazione/frenata via
  `corneringGripFactor`.
- Guida entro il margine di oggi: **percepibilmente identica** a prima —
  il modello non deve trasformarsi in una penalità di velocità generica
  applicata sempre, solo in un limite che si attiva quando lo si supera
  davvero.

### Parametro fisico interessato (vincolante)

L'unico parametro toccato è il **grip-blend** già consumato da
`AerodynamicsModel.applyGripBlend` — ma ATTENZIONE al segno: nella formula
esistente (`p.vx = p.vx*grip + fx*(1-grip)`), `grip` pesa quanto
`p.vx`/`p.vz` (il vettore velocità reale) **restano ancorati alla vecchia
direzione** invece di convergere verso il muso (`fx,fz` =
`sin(p.angle)*p.speed`, `cos(p.angle)*p.speed`) — è l'opposto
dell'intuizione naturale del nome. Verificato empiricamente simulando uno
sterzo sostenuto: a `grip` **alto** la divergenza tra muso e direzione di
marcia reale **cresce nel tempo** (sottosterzo/scivolata); a `grip`
**basso** la divergenza si stabilizza subito su un valore piccolo (l'auto
insegue il muso quasi perfettamente). Perché la domanda ecceda la
capacità deve produrre PIÙ scivolata, l'eccesso deve quindi **spingere
`grip` verso 1** (più ancoraggio alla vecchia direzione), non verso 0.
Riducendo `grip`, come farebbe una lettura naive della formula, si
otterrebbe l'opposto (auto più agile/aderente al muso). Spingendo `grip`
verso 1, NON si tocca:

- **`p.speed`** (lo scalare di velocità, dominio di `PowertrainModel`/
  `BrakingModel`) — resta invariato, l'auto non "rallenta" per effetto di
  questo modello;
- **il turn rate** (`p.angle`, dominio di `SteeringModel`) — resta
  invariato, l'auto sterza esattamente quanto chiesto.

L'effetto emerge invece a valle, in `VehicleMotionModel.integratePosition`:
se `p.vx`/`p.vz` convergono più lentamente verso dove punta il muso, la
**posizione reale** si allontana progressivamente dalla traiettoria che il
solo sterzo implicherebbe — cioè esattamente "scivolamento verso
l'esterno / sottosterzo progressivo", non un'auto più lenta o che sterza
meno. Questo è anche il motivo per cui il modello si applica al grip e non
altrove: è l'unico punto dell'architettura attuale dove esiste già uno
scarto (velocità reale vs direzione muso) su cui agire senza inventare una
nuova grandezza cinematica.

## 2. Variabili realmente necessarie

- `p.inputs.steer` (già esistente) e `p.speed`/`maxSpeed` → derivano la
  **domanda** laterale istantanea (stesso principio di `tractionDemand`:
  input pilota amplificato dalla velocità, nessuna nuova grandezza
  geometrica — niente raggio di curvatura, niente yaw rate).
- `TyreForceModel.corneringGripFactor(tyreWear, isQuali)` (già esistente)
  → la **capacità** disponibile, riusata as-is, non ricalcolata.
- Un eventuale stato persistente per player (`p._corneringSlipDebt`) —
  **non un requisito di questa fase**, vedi punto 5: si introduce solo se
  la verifica empirica mostra che l'eccesso istantaneo produce un effetto
  troppo "a scatto". Nota: nell'architettura attuale la frenata usa
  l'eccesso istantaneo SENZA debito persistente ed è già considerata
  adeguata — solo la trazione ha richiesto memoria. Il default di partenza
  per l'asse laterale è quindi "nessun debito", non il contrario.

## 3. Moduli esistenti coinvolti — e uno nuovo

Tre responsabilità separate, un modulo ciascuna — nessuna sovrapposizione:

| Responsabilità | Modulo | Cambia? |
|---|---|---|
| Capacità laterale disponibile (usura/mescola) | `TyreForceModel.js` | No — consumato as-is |
| Domanda laterale ed eccesso | `CorneringGripModel.js` (nuovo) | Nuovo, sola lettura/calcolo |
| Applicazione dell'effetto al grip | `VehiclePhysics.js` | Una riga in `updateVelocity` |

- **`TyreSlipModel.js`** — esteso con un terzo asse simmetrico a
  trazione/frenata: `corneringDemand(steer, speedFrac)`,
  `corneringExcess(steer, speedFrac, corneringCapacity)`. Nessuna funzione
  esistente modificata, solo aggiunte nello stesso stile (funzioni pure,
  capacità passata come parametro — mai importata internamente, così
  restano disaccoppiate da `TyreForceModel`, esattamente come
  `tractionExcess`/`brakingExcess` oggi).
- **`TyreForceModel.js`** — **consumato, non modificato**:
  `corneringGripFactor` è già esattamente la capacità che serve.
- **Nuovo modulo `CorneringGripModel.js`** — responsabilità **unica e
  ristretta**: tradurre lo stato del player (`p.inputs.steer`, `p.speed`,
  `maxSpeed`, `p.tyreWear`, `isQuali`) in un numero, l'eccesso laterale
  (0..1), chiamando `TyreForceModel.corneringGripFactor` per la capacità e
  `TyreSlipModel.corneringDemand`/`corneringExcess` per la domanda/il
  confronto. **Non riduce il grip, non tocca `p`, non possiede stato** —
  è una funzione di lettura, non di applicazione (`corneringExcess(p,
  isQuali, maxSpeed) → number`). Non duplica `TyreForceModel`: non
  ricalcola mai la capacità, la richiede e basta.
  **Perché un modulo nuovo e non dentro `AerodynamicsModel.js`:**
  `AerodynamicsModel.js` oggi calcola una capacità (mescola × usura ×
  danno fondo) che di per sé non è "aerodinamica" in senso stretto, ma
  concentrarci ANCHE la logica domanda/eccesso laterale (un fenomeno
  meccanico-pneumatico, non aerodinamico) approfondirebbe quella
  responsabilità impropria invece di correggerla. Un modulo dedicato:
  (a) segue esattamente il precedente architetturale trazione/frenata,
  dove la capacità vive in un modulo e la domanda/eccesso in un altro,
  consumati entrambi dal chiamante; (b) lascia `AerodynamicsModel.js`
  libero per il suo significato letterale futuro — quando arriverà il
  downforce (fuori scope ora), sarà lui a fornire un moltiplicatore di
  capacità aggiuntivo che `CorneringGripModel` riceverà come input alla
  capacità, senza dover spostare di nuovo codice da un file all'altro.
- **`VehiclePhysics.js`** — **unico punto che applica l'effetto**: in
  `updateVelocity`, dopo aver calcolato `grip = effectiveGrip(p, isQuali)`
  e prima di `applyGripBlend`, legge l'eccesso da `CorneringGripModel` e
  spinge `grip` verso 1 di conseguenza
  (`grip += (1 - grip) * lateralExcess * CORNERING_EXCESS_PENALTY_MAX` —
  vedi nota sul parametro fisico interessato per il perché è `+= verso 1`
  e non `*= verso 0`; costante da tarare in implementazione).
  `AerodynamicsModel.js` non richiede **nessuna modifica**: riceve un
  `grip` già modificato e applica il blend esattamente come oggi. L'ordine storico dei 5 passaggi (maxSpeed/grip →
  motore-o-freno-o-coast → clamp velocità → sterzo → blend aerodinamico)
  **non cambia**: si inserisce un calcolo su una variabile intermedia, non
  si sposta né si aggiunge uno step nella sequenza esistente.
- Flag di confronto dedicato (es. `F1_CORNERING_GRIP_MODEL=1`), stessa
  tecnica di rollout di Fase 2A/3.0 — a flag spento, comportamento
  bit-per-bit identico a oggi.
- *(Nota per dopo, non per questa fase: `docs/f1-notes.md` descrive oggi
  "5 sotto-moduli" — andrà aggiornato quando si implementa; `VehiclePhysics`
  resta l'orchestratore, `CorneringGripModel` non è un sesto passaggio
  della sequenza fisica ma un input calcolato prima di essa, non è un
  blocco per il design.)*

## 4. File che NON vanno toccati (scope confermato)

- **`f1Bot.js`** — nessuna modifica a `cornerTargetSpeed`, `apexOffset`, o
  qualunque altra logica IA. I bot non guadagnano consapevolezza del nuovo
  limite in questa fase: lo sperimentano solo passivamente, condividendo
  `updateVelocity` con i giocatori umani. L'integrazione IA è
  esplicitamente rimandata a un'eventuale Fase 5.
- **`f1RaceLineOptimizer.js`** — nessuna modifica: la linea precalcolata
  resta un calcolo geometrico offline, indipendente da questo lavoro.
- **`SteeringModel.js`** — governa `p.angle` (dove punta il muso), a monte
  e concettualmente indipendente dalla capacità laterale; il suo consumo
  esistente di `brakingExcess` (bloccaggio → meno sterzo) è un fenomeno
  separato, non va confuso né toccato.
- **`VehicleMotionModel.js`, `CollisionResolver.js`, `DamageModel.js`,
  `PowertrainModel.js`, `BrakingModel.js`** — nessuna formula di questi
  moduli dipende dall'asse laterale né viceversa.
- **`f1LapSimulator.js`** — **nessuna modifica in questa fase**. Motivo,
  scoperto in fase di pianificazione: lo strumento chiama sempre
  `updateVelocity(p, true, 1)` — `isQuali` è fisso a `true` — e
  `TyreForceModel`'s `corneringGripFactor` (come ogni fattore usura)
  ritorna sempre 1 quando `isQuali` è vero, **a prescindere da
  `tyreWear`**: lo stesso limite già noto per la migrazione di
  `TyreForceModel` ("f1LapSimulator insensibile alla taratura, isQuali
  hardcoded true"). Aggiungere un modo di impostare l'usura nel player
  simulato non servirebbe a nulla senza anche cambiare `isQuali`, e
  cambiare `isQuali` introdurrebbe *insieme* effetti su velocità
  massima/accelerazione/frenata (tutti gli altri fattori usura), rendendo
  impossibile isolare il solo contributo laterale — non voluto per questa
  fase. Il criterio 3 (fresca vs usurata) si verifica quindi con un test
  fisico isolato (vedi punto 5), non con questo strumento. Un'estensione
  futura di `f1LapSimulator.js` con una vera "modalità gara" (usura reale
  end-to-end, utile per validare strategie gomme complete) resta possibile
  ma è esplicitamente fuori scope qui.
- Editor tracciato, HUD, audio, scenografia, personalizzazione vettura —
  nessuna relazione con questo lavoro.

## 5. Criteri di successo (misurabili)

0. **Gomma fresca, guida entro il limite ⇒ comportamento odierno
   invariato**: il caso più comune (gomma fresca, sterzo/velocità nella
   norma) deve restare **praticamente indistinguibile** dal modello
   attuale — non solo "nessuna regressione teorica quando eccesso=0"
   (criterio 1), ma verificato concretamente: stesso giro, stesso profilo
   di guida "pulito", gomma fresca, flag acceso vs spento →
   `f1LapSimulator.js` deve produrre tempo sul giro e traiettoria
   praticamente identici. Questo è il criterio con la priorità più alta:
   se fallisce, il modello sta penalizzando anche la situazione che
   dovrebbe restare intoccata.
1. **Comportamento invariato entro il limite**: con domanda ≤ capacità,
   l'eccesso è sempre 0 e il grip restituito è bit-per-bit identico a
   oggi — verificabile come test diretto (eccesso=0 ⇒ nessuna riduzione).
2. **Perdita progressiva oltre il limite**: al crescere della domanda oltre
   la capacità, la riduzione di grip cresce in modo continuo e monotono —
   nessuna discontinuità nel punto in cui si supera il limite (stesso
   principio di continuità già usato per la curva "cliff" dell'usura).
3. **Differenza evidente fresca vs usurata**: **non verificabile con
   `f1LapSimulator.js`** in questa fase (lo strumento gira sempre con
   `isQuali=true`, che azzera l'usura per ogni fattore — vedi punto 4).
   Verificato invece con un test fisico isolato, fuori dal ciclo di gara:
   stesso `steer`/`speedFrac`, `isQuali=false` esplicito, confrontando
   `CorneringGripModel.lateralExcess` (o le funzioni pure sottostanti) a
   `tyreWear=0` vs `tyreWear` elevato (es. 80) — la capacità
   (`corneringGripFactor`) e di conseguenza l'eccesso devono differire in
   modo coerente (più usura ⇒ capacità minore ⇒ eccesso maggiore o uguale
   a parità di domanda), esattamente come già verificato per trazione/
   frenata in `TyreForceModel.test.js`/`TyreSlipModel.test.js`.
4. **Nessuna trasformazione in "auto più lenta e basta"**: un profilo di
   guida "pulito" (sterzo/velocità sempre entro il margine di oggi) deve
   produrre tempo sul giro pressoché identico a flag spento vs acceso;
   solo un profilo "sporco" (sterzo tardivo/brusco, eccesso reale) deve
   mostrare una differenza. **Scoperta in fase di esecuzione (Task 4 del
   piano): non verificabile end-to-end con `f1LapSimulator.js`**, per lo
   stesso motivo del criterio 3 — lo strumento gira sempre con
   `isQuali=true` (capacità sempre 1) e `corneringDemand` è deliberatamente
   senza boost (proprio per rispettare il criterio 0), quindi la domanda
   non può mai eccedere una capacità che è sempre 1, a prescindere da
   `--speed-factor` o da quanto aggressivo sia il profilo di guida
   simulato. Non è un fallimento del modello, è una conseguenza diretta e
   attesa delle due scelte di design sopra. Il "profilo sporco" a livello
   di singolo tick è già verificato dai test isolati dei Task 2/3
   (`tyreWear` elevato, `isQuali=false`, grip modificato in modo
   misurabile); la conferma end-to-end (tempo sul giro percepibile in una
   gara vera) si sposta al playtest umano (Task 6), unico contesto in cui
   `isQuali=false` esiste davvero.

## 6. Strategia incrementale di implementazione

- **Step 1 — Funzioni pure in `TyreSlipModel.js`.** Aggiungere
  `corneringDemand`/`corneringExcess`, stesso stile delle coppie esistenti.
  Test: domanda entro capacità → eccesso zero; domanda oltre capacità a
  velocità medio-alta → eccesso positivo e monotono nella velocità/intensità
  di sterzo. Nessun player, nessun tick — solo funzioni pure, come già
  fatto per trazione/frenata.
- **Step 2 — Nuovo `CorneringGripModel.js` (sola lettura/calcolo) +
  applicazione in `VehiclePhysics.js`, dietro flag spento di default.**
  Test di non-regressione: a flag spento, `updateVelocity` produce output
  bit-per-bit identico a oggi (stessa rete di sicurezza già usata nel
  refactoring Vehicle Dynamics). A flag acceso, test diretto sui criteri
  1, 2 e 4 del punto 5 a livello di funzione, più il criterio 3 isolato
  (`tyreWear=0` vs `tyreWear` elevato, `isQuali=false` esplicito — vedi
  punto 5) — senza ancora introdurre memoria/debito. Il criterio 0
  (end-to-end) richiede `f1LapSimulator.js`, vedi Step 3.
- **Step 3 — Verifica con `f1LapSimulator.js` a flag acceso** (criterio 0
  soltanto). **Scoperta in esecuzione**: la capacità in questo strumento è
  sempre 1 (`isQuali=true` fisso) e `corneringDemand` è senza boost per
  design — quindi né il criterio 3 né il criterio 4 sono osservabili qui,
  a prescindere da quanto "sporco" sia il profilo simulato (l'eccesso resta
  sempre 0). Confermato con un confronto a seed RNG fissato (per isolare il
  rumore preesistente di `botLapPaceMult` in `f1Bot.js`, non legato a
  questa fase): flag acceso e spento producono lo stesso identico tempo sul
  giro, sia a `--speed-factor=1` che a `--speed-factor=1.3` — criterio 0
  confermato rigorosamente, criterio 4 end-to-end non verificabile con
  questo strumento (resta verificato a livello di singolo tick dai test
  isolati del Task 2/3). La decisione sul debito persistente si sposta
  quindi al playtest umano (Step 4/Task 6), unico contesto con
  `isQuali=false`: se il comportamento "sporco" in gara si sente come un
  recupero già ragionevolmente graduale tick su tick, il debito NON si
  introduce. Se invece l'effetto appare a scatti (stesso sintomo già visto
  per la trazione in Fase 3.0/3A), si aggiunge `updateCorneringSlipDebt` in
  `TyreSlipModel.js` con la stessa forma rise/decay già validata (funzione
  pura, nessuna interfaccia esistente cambia). La titolarità dello stato
  (`p._corneringSlipDebt`) segue la stessa ripartizione del punto 3: non
  spetta a `CorneringGripModel` (resterebbe sola lettura/calcolo anche in
  questo caso), ma a `VehiclePhysics.js`, che già possiede il ruolo di
  "applicazione dell'effetto".
- **Step 4 — Playtest umano in localhost** sui criteri del punto 5,
  giudizio soggettivo su "sottosterzo progressivo credibile" vs "auto
  ingestibile"/"auto spenta" — stessi due fallimenti già osservati e
  corretti in Fase 3.1, criteri di accettazione anche qui.
- **Attivazione di default solo dopo Step 4 approvato**, coerente con la
  promozione di TyreForceModel (Fase 2B) e TyreSlipModel finora: mai un
  flag acceso di default senza playtest umano superato.

## Esito playtest (2026-07-28)

Gomma poco usurata: nessuna differenza percepibile rispetto a prima —
atteso (criterio 0), il limite raramente si avvicina in quelle condizioni
per design (nessun boost sulla domanda). Gomma usurata: sottosterzo
progressivo percepito e giudicato credibile, nessun taglio improvviso, nessuna
sensazione di "auto più lenta e basta" — criteri 2/4 soddisfatti
qualitativamente. Nessun effetto "a scatti" osservato: **il debito
persistente (Task 5 del piano) non è stato introdotto**, in base al
criterio di decisione concordato. Flag ancora spento di default —
l'eventuale attivazione di default resta una decisione dell'utente, non
automatica da questo lavoro.
