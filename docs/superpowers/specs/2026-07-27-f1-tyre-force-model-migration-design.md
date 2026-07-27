# F1 — TyreForceModel: livello di influenza gomme simcade (piano di migrazione, scope ridotto)

## Contesto

`VehicleDynamics`/`VehiclePhysics` sono stati modularizzati (Rif.
`docs/superpowers/plans/2026-07-27-f1-vehicle-dynamics-refactor.md`,
`docs/f1-notes.md`) in 5 sotto-moduli (`PowertrainModel`, `BrakingModel`,
`SteeringModel`, `AerodynamicsModel`, `VehicleMotionModel`) senza cambiare
nessuna formula — un refactoring puramente di collocazione codice. Questo
documento è il passo successivo: **non tocca ancora il codice**, ma
analizza il `TyreModel.js` attuale e propone un piano incrementale per
farlo evolvere verso un feeling gomme più simcade.

**Revisione di scope (questa versione):** la prima bozza di questo
documento proponeva di arrivare, in più fasi, a un vero force model
(Fx/Fy integrate su massa vettura, sostituzione della pipeline di
`VehiclePhysics`). Dopo revisione, lo scope è stato **ridotto
deliberatamente**: l'obiettivo prioritario non è più costruire un force
model completo, ma migliorare il feeling delle gomme mantenendo il
comportamento attuale della vettura come baseline. Il force model completo
resta un'opzione futura, non una fase pianificata di questo documento —
vedi "TyreForceModel: modulo aggiuntivo, non sostitutivo".

Non esiste nel repo un file "Vehicle Dynamics Specification" — è una
specifica progettuale esterna all'utente, riassunta qui nella sezione
"Filosofia del modello target" e usata come riferimento concettuale.

## Filosofia del modello target

Obiettivo: un modello **simcade**, non un simulatore hardcore. Principi
fondamentali forniti dall'utente:

- Il server rimane autorevole; il client invia solo input e interpola —
  invariante già rispettato oggi (`frontend/f1.js` non duplica formule).
- Nessun sistema deve applicare modificatori arbitrari tipo "-20% grip":
  gli effetti devono **emergere** da poche grandezze fisiche, non essere
  percentuali dirette incollate all'output.
- Pipeline concettuale:

  ```
  Input → Vehicle Systems → Tyre Behaviour → Vehicle Motion → Vehicle State
  ```

  **Nota di scope**: in questo documento, "Tyre Behaviour" è un **sistema
  aggiuntivo** che alimenta con nuovi fattori i moduli scalari già
  esistenti (`PowertrainModel`/`BrakingModel`/`AerodynamicsModel`), non uno
  stadio "Forces" che sostituisce la pipeline con integrazione vettoriale
  su massa. La pipeline reale resta quella di oggi
  (`VehiclePhysics.updateVelocity`); "Tyre Behaviour" si inserisce come
  fornitore di dati per i moduli esistenti, non come loro sostituto.

- Il `TyreForceModel` diventa, nel tempo, il cuore della simulazione
  gomme — ma questa versione del documento ne pianifica solo la nascita
  come modulo isolato e il suo primo innesto additivo, non la sostituzione
  della dinamica vettura.

## Decisioni progettuali

Queste decisioni sono vincolanti per tutte le fasi di questo documento.

### TyreForceModel: modulo aggiuntivo, non sostitutivo

Decisione cardine di questa revisione: il `TyreForceModel`

- **nasce come modulo isolato e testabile**, a sé stante — non sostituisce
  `PowertrainModel`, `BrakingModel` o `SteeringModel` all'atto della sua
  creazione;
- quando viene collegato al gioco (fase di wiring prevista qui, vedi Fase
  2A/2B), lo fa **alimentando i punti di ingresso già esistenti** dei
  moduli attuali (gli stessi che oggi consumano `WEAR_*_PENALTY` e i
  moltiplicatori di mescola) — non sostituisce la loro struttura, il loro
  ordine di chiamata, né la forma della pipeline;
- il collegamento avviene **in due passi separati e reversibili**: prima
  in affiancamento al modello esistente, senza rimuovere nulla (Fase 2A),
  poi — solo dopo playtest e validazione positiva — con la rimozione dei
  vecchi modificatori (Fase 2B). Il vecchio modello resta l'unica fonte di
  verità applicata di default finché la Fase 2B non è stata
  esplicitamente validata;
- **non introduce F=ma, non integra forze vettoriali, non richiede una
  massa vettura** in questa fase — resta nel dominio scalare in cui vive
  oggi `updateVelocity`;
- l'eventuale evoluzione verso un vero force model (Fx/Fy integrate,
  massa, sostituzione strutturale di Powertrain/Braking/Steering) è un
  **punto di decisione futuro**, esplicitamente fuori scope qui: si
  valuta *dopo* aver validato in localhost il livello di influenza gomme
  (Fase 2B), con un piano dedicato a parte.

Questa è la lettura operativa di "prima aggiungere un livello di influenza
gomme, poi valutare se sostituire parti della dinamica".

### Approccio: simcade semplificato, non Pacejka

Confermato dalla revisione precedente, con scope ulteriormente ridotto: il
`TyreForceModel` non implementa modelli professionali da simulatore
hardcore (Pacejka "Magic Formula" o equivalenti). In questa prima
versione, il modulo non deve nemmeno produrre necessariamente forze
esplicite (Fx/Fy in Newton) — può produrre **fattori di influenza
adimensionali** (es. "quota di trazione disponibile", "quota di aderenza
in frenata disponibile", "quota di aderenza in curva disponibile", ognuno
0..1) calcolati a partire da concetti ispirati allo slip (mescola, usura,
quanto viene "chiesto" al pneumatico rispetto a quanto può dare), pur
senza costruire un vero modello ruota/carrozzeria con velocità ruota
separata o carico verticale dinamico.

Il modello deve restare:

- **semplice**: poche grandezze, non decine di coefficienti;
- **stabile**: nessuna instabilità/oscillazione numerica;
- **facilmente tarabile**: pochi parametri comprensibili per il tuning;
- **adatto al realtime multiplayer web**: costo trascurabile per tick, per
  N giocatori/bot, dentro il budget del tick server (Rif.
  `f1GameSocket.js::tickGame`).

La formula esatta di questi fattori di influenza non è decisa in questo
documento — è materia della Fase 0/1.

### Nota sul friction model (concettuale, non implementata come vincolo di forze)

Il friction circle classico resta il riferimento **concettuale** con cui
ragionare su questi fattori di influenza:

```
Fx² + Fy² ≤ (μFz)²
```

cioè l'idea che l'aderenza disponibile è un budget condiviso tra
longitudinale e laterale, non due limiti indipendenti. In questa versione
a scope ridotto, questo principio **ispira** il calcolo dei fattori di
influenza (es. chiedere contemporaneamente molta accelerazione e molto
sterzo può ridurre entrambi i fattori disponibili), ma **non viene
implementato come vincolo rigoroso su forze integrate** — non c'è un vero
Fx/Fy da vincolare, perché non c'è ancora un'integrazione di forze. Una
eventuale friction ellipse (differenziazione accelerazione/frenata/curva)
resta, come nella revisione precedente, non decisa — rimandata a quando
(e se) si deciderà di costruire un vero force model.

### Massa e forze: rimandate

A differenza della versione precedente di questo documento, **questa
revisione non introduce alcun parametro di massa vettura**, né F=ma, né
integrazione vettoriale di forze. Non essendoci un'integrazione di forze
in questa fase, non serve una massa per convertirle in accelerazione — il
concetto è rimandato in blocco al punto di decisione futuro sul force
model completo (vedi "TyreForceModel: modulo aggiuntivo, non
sostitutivo").

### DamageModel avanzato: confermato fuori scope

Confermato dalla revisione precedente. Il `TyreForceModel` deve lasciare
spazio, nella sua interfaccia, a input futuri di temperatura, danno e
perdita di prestazioni dei componenti — ma nessuno di questi viene
implementato ora. Il `DamageModel` esistente resta esattamente come oggi.

## Cosa deve produrre la prima versione (Player Perceived Goals)

Criterio di successo non è l'accuratezza rispetto a dati reali, ma le
**sensazioni** percepite da chi gioca. La prima versione del
`TyreForceModel`, una volta diventata la sorgente applicata di default
(Fase 2B, dopo il periodo di confronto in Fase 2A), deve far percepire:

- **differenza mescole**: soft/medium/hard devono sentirsi diverse non
  solo come velocità massima, ma come "carattere" (quanto sono
  prevedibili/scivolose);
- **usura gomme**: il degrado percepito deve restare quello della curva
  "cliff" già esistente, ma derivare da un unico fattore fisico-ispirato
  invece che da 4 penalità scollegate;
- **perdita di trazione** in accelerazione (proxy di wheelspin) quando si
  chiede più accelerazione di quella che il fattore di trazione
  disponibile permette;
- **peggioramento della frenata** quando si chiede più decelerazione di
  quella che il fattore di frenata disponibile permette (proxy di
  bloccaggio ruote);
- **perdita di aderenza in curva** (proxy di sottosterzo/sovrasterzo)
  quando la richiesta di sterzo supera il fattore di aderenza laterale
  disponibile.

Ognuno di questi 5 effetti deve mappare su un **punto di consumo già
esistente** nella pipeline attuale, senza restrutturarla:

| Effetto percepito | Punto di consumo esistente |
|---|---|
| Differenza mescole | `tyreOf(p, isQuali)` (già esistente) |
| Usura gomme | Affianca (2A), poi eventualmente sostituisce (2B) le 4 `WEAR_*_PENALTY` con un fattore unico consumato dagli stessi punti |
| Perdita di trazione | `PowertrainModel.effectiveAccel` |
| Peggioramento frenata | `BrakingModel.effectiveBrakeMult` |
| Perdita di aderenza in curva | `AerodynamicsModel.effectiveGrip` |

Il modello **non deve** simulare ogni dettaglio fisico reale del
pneumatico, né produrre valori assoluti confrontabili con telemetria
professionale — l'obiettivo è la sensazione riconoscibile con il minimo
di struttura nuova necessaria.

## Confronto: modello attuale vs primo target (scope ridotto)

### Tyre Model

| | Attuale (`TyreModel.js`) | Primo target (questo documento) |
|---|---|---|
| Rappresentazione mescola | 3 numeri diretti per compound: `speedMult`, `gripMult`, `wearRate` | Invariata nella forma; il `TyreForceModel` può arricchirla con un fattore di "carattere" (quanto è scivolosa) senza cambiare `speedMult`/`gripMult` |
| Effetto usura | Curva "cliff" moltiplicata per **4 penalità dirette e indipendenti** | Un solo fattore fisico-ispirato (0..1), calcolato una volta, che affianca (2A) e poi sostituisce (2B, dopo validazione) le 4 costanti scollegate |
| Output | Moltiplicatori scalari consumati separatamente | Ancora moltiplicatori/fattori scalari — **non** Fx/Fy in Newton — consumati dagli stessi 3 punti esistenti |
| Carico verticale (Fz) | Assente | Ancora assente in questa fase (rimandato) |
| Slip | Assente | Concetto **ispiratore** interno al calcolo dei fattori (quanto viene chiesto vs quanto è disponibile), non un vero slip cinematico ruota/vettura |
| Temperatura | Assente | Prevista come input futuro nell'interfaccia, non implementata |
| Danno | Vive in `DamageModel` come penalità dirette | Invariato in questa fase |

### Pipeline Vehicle Dynamics — invariata

Oggi e dopo questa fase (`VehiclePhysics.updateVelocity`):

```
input → Powertrain/Braking/Coast (delta diretto su p.speed, scalare)
      → clamp a maxSpeed
      → Steering (incrementa p.angle di un turnRate in rad/tick)
      → Aerodynamics.applyGripBlend (vx/vz = blend(vx/vz, proiezione di speed su angle, peso = GRIP))
```

**Questa struttura non cambia in questo documento.** L'unico cambiamento,
e solo a partire dalla Fase 2B, è *da dove* provengono i fattori
consumati da `effectiveAccel`, `effectiveBrakeMult`, `effectiveGrip`: non
più da 4 costanti `WEAR_*_PENALTY` scollegate, ma da un unico
`TyreForceModel`. In Fase 2A le 4 costanti restano la fonte applicata di
default; il `TyreForceModel` è calcolabile in affiancamento per
confronto, non ancora l'unica fonte. Nessuno step "Forces"/F=ma viene
introdotto in nessuna delle due sotto-fasi; nessuna massa; nessuna
integrazione vettoriale nuova.

### Grip: cosa significa oggi, e cosa significherà dopo questa fase

Scoperta rilevante per il piano, confermata dalla revisione precedente:
**il "grip" attuale non è un vincolo fisico**. `AerodynamicsModel.GRIP`
controlla solo quanto in fretta `vx/vz` convergono verso la direzione del
muso — un filtro di lag, non un limite di aderenza. La velocità massima
in curva è governata geometricamente da `f1Bot.js::cornerTargetSpeed =
radius × turnRateAtMax × margin`, senza alcun termine di attrito.

**Con lo scope ridotto di questo documento, questo non cambia.** Dopo la
Fase 2B, `effectiveGrip` sarà più "vivo" (deriva da un fattore
fisico-ispirato invece che da una penalità fissa per fascia di usura), ma
resta un fattore di blend consumato dalla stessa `applyGripBlend` di oggi
— non diventa un vincolo di forza reale, e non introduce un vero slip
angle o un friction circle applicato a forze integrate. La differenza tra
"oggi" e "target di lungo periodo" descritta nella versione precedente di
questo documento resta valida come **direzione**, ma non è più pianificata
qui: è demandata al punto di decisione futuro.

## Cosa esiste già e si può riusare

- **Architettura modulare** (5 sotto-moduli + facade `VehicleDynamics`):
  il `TyreForceModel` si innesta qui dentro, dietro la facade — nessun
  tocco a `f1GameSocket.js`.
- **Concetto di compound**: riusabile come input al `TyreForceModel`.
- **Concetto di usura** (`tyreWear` 0-100, curva "cliff"): riusabile
  concettualmente — è proprio il pezzo che questa fase consolida da 4
  penalità scollegate a un unico fattore.
- **Flag `isQuali`**: resta valido così com'è.
- **Pattern di test di caratterizzazione** e **baseline
  `f1LapSimulator.js --all-tracks`**: riusabile come rete di sicurezza
  per-fase — con la differenza che solo la Fase 2B *cambia
  intenzionalmente* il feeling applicato di default di usura/mescola,
  quindi la baseline andrà ridefinita esplicitamente lì. In Fase 2A la
  baseline di default deve restare identica: è proprio quello che rende
  la fase reversibile.

## Fasi di migrazione (scope ridotto)

Ogni fase lascia il gioco funzionante e verificabile in localhost.
Nessuna fase tocca multiplayer/networking/server-authority,
`SteeringModel` come struttura, o `f1GameSocket.js`.

### Fase 0 — Interfaccia isolata del `TyreForceModel`

Definire il modulo `TyreForceModel.js` come funzioni pure e isolate che
calcolano i 3 fattori di influenza (trazione, frenata, aderenza in curva
— vedi tabella "Cosa deve produrre la prima versione") a partire da
mescola e usura. Zero dipendenza da `p` (stato giocatore) o da altri
moduli fisica — riceve solo i valori scalari che oggi già esistono
(compound, tyreWear). Nessun file esistente viene modificato in questa
fase; il modulo non è collegato a nient'altro.

Va inoltre specificato, come contratto, il concetto "ispirato allo slip"
usato internamente (es. quanto viene chiesto al pneumatico in un tick vs
quanto può dare) — resta interno al modulo, non richiede un vero modello
ruota/vettura separato.

### Fase 1 — Validazione isolata

Test di caratterizzazione sul modulo puro, senza alcun collegamento al
gioco: gomma nuova → fattori vicini a 1, gomma esaurita → fattori ridotti
secondo la stessa curva "cliff" di oggi, differenza tra mescole coerente
con gli attuali `speedMult`/`gripMult`. Nessun impatto su gameplay: il
modulo non è ancora consumato da nessuno.

### Fase 2A — Integrazione parallela/compatibile (nessuna rimozione)

Il `TyreForceModel` viene collegato al gioco **in affiancamento** al
modello attuale, non al suo posto. Obiettivo: rendere possibile calcolare
e confrontare il fattore prodotto dal nuovo modello con quello prodotto
oggi dalle 4 `WEAR_*_PENALTY`, senza che il comportamento di gioco
applicato di default cambi.

Vincoli specifici di questa sotto-fase:

- le 4 `WEAR_*_PENALTY` e il loro punto di consumo in
  `PowertrainModel`/`BrakingModel`/`AerodynamicsModel` **restano intatte
  e sono ciò che guida il comportamento di default** — nessuna rimozione,
  nessuna sostituzione ancora;
- il `TyreForceModel` diventa raggiungibile da questi moduli, ma il suo
  output è **calcolabile per confronto**, non necessariamente ciò che
  determina il comportamento applicato di default — la forma esatta del
  meccanismo di confronto/fallback (es. percorso attivabile per
  verifica/playtest vs percorso sempre-attivo con possibilità di
  ripristino immediato del vecchio) è una decisione implementativa, da
  prendere nel piano di codice, non in questo documento;
- qualunque meccanismo scelto deve garantire che **tornare al
  comportamento attuale sia immediato e senza perdita di codice** (nessun
  file/percorso vecchio viene eliminato in questa sotto-fase);
- il costo per-tick del calcolo in affiancamento deve restare trascurabile
  (vedi vincolo "adatto al realtime multiplayer web" in "Decisioni
  progettuali") — non deve degradare il tick loop per N giocatori/bot
  anche quando il confronto è attivo.

Gli export storici (`effectiveMaxSpeed`, `effectiveAccel`,
`effectiveBrakeMult`, `effectiveGrip`) restano identici nella forma per i
consumer esterni (`f1Bot.js`, `f1LapSimulator.js`,
`f1RaceLineOptimizer.js`, `f1GameSocket.js`).

Questa sotto-fase **non deve cambiare il comportamento di default
percepito in gioco** — è il presupposto per poter fare il confronto in
sicurezza. Il confronto vero e proprio (giocare/testare con il nuovo
modello attivo) avviene come parte della validazione di questa sotto-fase,
non come cambiamento permanente.

### Fase 2B — Rimozione dei vecchi modificatori (solo dopo validazione positiva)

Solo dopo che il confronto della Fase 2A ha dato esito positivo (playtest
utente, criteri in "Criteri di validazione"), le 4 `WEAR_*_PENALTY`
vengono rimosse e il `TyreForceModel` diventa l'**unica** fonte dei
fattori per `effectiveAccel`/`effectiveBrakeMult`/`effectiveGrip`.
Struttura, ordine di chiamata e firme pubbliche dei moduli restano
invariate — cambia solo la fonte del numero, ora in modo definitivo. È il
punto in cui il feeling di usura/mescola cambia stabilmente per tutti i
giocatori.

Questa sotto-fase è **esplicitamente reversibile solo tramite git**
(nessun fallback applicativo residuo dopo la rimozione) — è per questo che
deve avvenire solo dopo la validazione della 2A, non prima.

### Punto di decisione futuro (non pianificato qui)

Dopo aver validato la Fase 2B in localhost, si valuta — con un documento a
parte, non con questo — se e come procedere verso un vero force model:
Fx/Fy in Newton, massa vettura, F=ma, slip angle cinematico reale,
eventuale sostituzione strutturale di `SteeringModel`/`PowertrainModel`/
`BrakingModel`, e impatto su AI/racing line (`cornerTargetSpeed`,
rigenerazione delle racing line offline). Nessuna di queste cose è
decisa, pianificata o implicata da questo documento.

### Fase futura, non pianificata — interfaccia per temperatura/danno

Come già confermato: l'interfaccia del `TyreForceModel` dovrebbe lasciare
spazio a temperatura e danno come input futuri, ma la loro
implementazione resta fuori scope, sia di questo documento sia
dell'eventuale force model completo.

## Rischi

- **Reintrodurre modificatori arbitrari sotto altro nome**: il rischio
  principale della Fase 2B è costruire un `TyreForceModel` che, di fatto,
  è ancora 3-4 percentuali scollegate rinominate. Mitigazione: il modulo
  deve derivare i 3 fattori da un'**unica** grandezza interna (es. un solo
  "budget di aderenza" per la curva usura/mescola), non da 3-4 curve
  indipendenti tarate separatamente.
- **Consumer del `module.exports` storico**: un cambio di *significato*
  (non solo di formula) di `effectiveGrip`/`effectiveAccel`/
  `effectiveBrakeMult` rompe silenziosamente `f1Bot.js`,
  `f1LapSimulator.js`, `f1RaceLineOptimizer.js` se le firme non vengono
  preservate esattamente, sia in 2A che in 2B.
- **Test di caratterizzazione esistenti**: fissano i valori attuali
  bit-per-bit; in Fase 2A devono restare verdi e identici (il default non
  cambia); vanno aggiornati consapevolmente solo in Fase 2B (che cambia
  intenzionalmente il feeling applicato di default), non semplicemente
  "corretti per far passare la suite".
- **Feeling di guida**: la Fase 2B cambia di proposito come si sente
  l'usura/mescola — richiede playtest utente dedicato in 2A (sul percorso
  di confronto) *prima* di autorizzare 2B, per confermare che il
  cambiamento sia percepito come miglioramento, non come regressione
  imprevista.
- **Stato ibrido prolungato (Fase 2A)**: mantenere due implementazioni
  parallele (vecchia autorevole + nuova in confronto) è debito tecnico
  temporaneo per definizione — se la 2B non viene mai autorizzata o viene
  rimandata a tempo indeterminato, il doppio percorso rischia di
  diventare permanente. Mitigazione: la 2A si considera chiusa solo con un
  esito esplicito (procedi a 2B / non procedere e rivedi il modello), non
  lasciata aperta indefinitamente.
- **Scope creep verso il force model completo**: il rischio opposto a
  quello di partenza — durante l'implementazione della Fase 0/2A/2B è
  facile essere tentati di "aggiungere già" slip angle o massa "già che
  ci si è". Il punto di decisione futuro esiste apposta per tenere questo
  fuori da questo piano.

## Impatto su AI / racing line

**Zero impatto, per l'intero scope di questo documento.** I bot
(`f1Bot.js`) e l'ottimizzatore offline (`f1RaceLineOptimizer.js`) usano
`cornerTargetSpeed = radius × turnRateAtMax × margin`, un limite
puramente cinematico legato allo sterzo — nessuna fase di questo
documento tocca lo sterzo, `SteeringModel`, o il modo in cui i bot
calcolano la velocità in curva. Le racing line precalcolate
(`*-raceline.json`) restano valide senza bisogno di rigenerazione.

L'unico punto in cui l'AI potrebbe essere indirettamente interessata è la
Fase 2B (quando il nuovo fattore diventa applicato di default): se cambia
sensibilmente il "feeling" di quanto l'auto segue l'angolo del muso, vale
la pena una verifica rapida che i bot completino
comunque il giro senza uscire di pista più spesso di oggi — non perché il
loro limite di velocità cambi (non cambia), ma perché lo smorzamento
vx/vz potrebbe accumularsi diversamente su curve strette. Non è un rischio
strutturale come quello descritto nella versione precedente di questo
documento (che prevedeva di sostituire il limite cinematico con uno
fisico), solo una verifica di buon senso.

## Vincoli invariati

- **Server autorevole**: nessuna fase sposta calcoli fisici sul client;
  `frontend/f1.js` continua a inviare solo input e interpolare stato.
- **Networking/multiplayer invariati**: nessuna fase tocca
  `socketManager.js`, la struttura dei messaggi socket, o la logica di
  lobby/pit-stop/lap-tracking.
- **`f1GameSocket.js` non viene ritoccato**: tutte le fasi lavorano dentro
  `backend/sockets/games/physics/`, dietro la facade `VehicleDynamics`
  già esistente.
- **`SteeringModel`, `PowertrainModel`, `BrakingModel` non vengono
  sostituiti strutturalmente**: la Fase 2A/2B cambia solo la fonte di un
  fattore che già consumavano, non la loro forma/ordine/firma.
- **Nessuna massa, nessun F=ma, nessuna integrazione di forze** in questo
  documento.
- **Nessuna regressione non reversibile**: la Fase 2A non rimuove né
  sostituisce il comportamento di default; la rimozione dei vecchi
  modificatori avviene solo in Fase 2B, solo dopo validazione positiva
  esplicita.
- **Passi piccoli**: ogni fase è indipendentemente verificabile e
  reversibile; nessuna fase introduce codice non testato o non giocabile.

## Criteri di validazione per fase

- **Fase 0/1**: suite `node --test` verde con i nuovi test del
  `TyreForceModel` isolato; nessun altro test esistente cambia risultato
  (il modulo non è ancora collegato a nulla); confronto
  `f1LapSimulator.js --all-tracks` identico alla baseline attuale (zero
  wiring, zero impatto).
- **Fase 2A**: suite `node --test` esistente verde e **identica** nei
  risultati (il comportamento di default non cambia), più nuovi test che
  verificano che il percorso di confronto produca i fattori attesi dal
  `TyreForceModel`. Confronto `f1LapSimulator.js --all-tracks` sul
  comportamento di default: **identico** alla baseline attuale.
  Verifica esplicita, separata, del comportamento con il nuovo modello
  attivo (playtest in localhost con le 3 mescole a diversi livelli di
  usura) — è questo il confronto che decide se autorizzare la Fase 2B.
  Chiudere la 2A richiede un esito scritto esplicito (procedi a 2B / non
  procedere).
- **Fase 2B** (solo dopo esito positivo della 2A): suite `node --test`
  verde, con gli aggiornamenti attesi e documentati esplicitamente ai
  test di caratterizzazione di
  `PowertrainModel`/`BrakingModel`/`AerodynamicsModel`/`VehiclePhysics`
  (il feeling usura/mescola cambia di proposito, ora in modo definitivo).
  Confronto `f1LapSimulator.js --all-tracks`: atteso diverso dalla
  baseline in modo commentato, non identico. Verifica utente in
  localhost (due tab, qualifica + gara, con pit stop) — nessuna
  regressione percepita oltre al cambiamento già validato in 2A.
  Verifica di buon senso che i bot completino il giro senza uscire di
  pista più spesso di oggi.

## Cosa NON fa questo documento

- Non implementa F=ma, non introduce una massa vettura, non integra
  vettorialmente forze.
- Non sostituisce `SteeringModel`, `PowertrainModel` o `BrakingModel`
  come struttura — li fa solo consumare un fattore da una fonte diversa.
- Non rimuove le vecchie `WEAR_*_PENALTY` nella stessa fase in cui
  introduce il `TyreForceModel` — la rimozione (Fase 2B) è
  esplicitamente separata dall'integrazione (Fase 2A) e condizionata a
  una validazione positiva.
- Non tocca `cornerTargetSpeed`, l'AI, o le racing line precalcolate.
- Non decide se o quando costruire un force model completo — quel punto
  di decisione è esplicitamente rimandato a un documento futuro separato.
- Non definisce le formule esatte dei fattori di influenza (costanti,
  curve) — è materia della Fase 0/1.
- Non tocca temperatura o danno come input fisici — solo lo slot
  nell'interfaccia è previsto, non l'implementazione.
- Non contiene codice, come richiesto esplicitamente.
