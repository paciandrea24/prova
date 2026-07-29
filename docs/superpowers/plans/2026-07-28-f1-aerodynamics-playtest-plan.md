# F1 — Fase Aero: piano playtest attivazione progressiva

**Contesto:** le 4 fasi (drag, downforce, danno aero, scia) sono
implementate, testate a livello unitario/integrazione e documentate — ma
**nessun flag è mai stato provato in localhost da un umano**. Questo
documento fissa l'ordine e i criteri per farlo, senza introdurre nuovo
codice. Riferimento:
`docs/superpowers/specs/2026-07-28-f1-aerodynamics-model-design.md`
("Stato finale — checkpoint").

## Principio generale

Un flag alla volta, poi le combinazioni — mai "tutti e 4 insieme" al primo
giro, per poter attribuire con certezza qualunque sensazione strana al
flag giusto. Stesso criterio già usato per Fase 4 (Cornering Grip Limit):
nessuna promozione a default senza playtest umano esplicito, nessun
obbligo di attivare tutto subito.

Ogni step: avviare il server con la env var **prima** dell'avvio
(`F1_XXX=1 node server.js` dalla cartella `backend/`, mai a runtime — i
flag sono letti una volta per tick da `process.env`, non serve riavviare
per ogni tick, ma cambiarli richiede riavviare il processo), due tab
(umano + bot) per avere un riferimento di confronto in tempo reale.

## Step 1 — Drag da solo (`F1_AERO_DRAG_MODEL=1`)

**Cosa provare:** rettilinei lunghi (es. `new-monza`), a tutta velocità,
qualifica e gara. Con mescola diversa (soft/medium/hard) per sentire se il
drag altera la percezione di differenza tra mescole.

**Cosa cercare:**
- Il tetto di velocità massima deve calare percettibilmente rispetto a
  oggi (fino al 5% a `speedFrac=1`) — non deve sembrare "quasi
  impercettibile" né "l'auto è improvvisamente lenta".
- Nessun effetto vicino a curve lente/uscita dai box (drag basso a bassa
  velocità, per design).

**Criteri di rollback:** se il calo di top speed è impercettibile →
aumentare `DRAG_TOP_SPEED_PENALTY_MAX` (oggi 0.05) in
`AerodynamicsModel.js`. Se sembra eccessivo/l'auto è "frenata" anche a
velocità medie → verificare `DRAG_EXPONENT` (oggi 2, quadratico):
probabilmente va aumentato, non ridotto (rende l'effetto più concentrato
verso il fondo scala).

**ESITO (2026-07-28):** confermato percepibile sul tetto di velocità
massima a fine rettilineo, intensità giudicata giusta, nessuna stranezza
altrove (curve/box/qualifica). Nessuna ritaratura delle costanti
necessaria. Flag resta spento di default; l'eventuale attivazione resta
una decisione dell'utente.

## Step 2 — Downforce da solo (`F1_AERO_DOWNFORCE_MODEL=1`, drag spento)

**Cosa provare:** curve veloci (es. variante alta velocità di
`new-monza`), gomma **usurata** in gara (isQuali=false necessario: la
capacità è sempre piena in qualifica, l'effetto non si sente lì per
design — atteso, non un bug).

**Cosa cercare:**
- A parità di usura, in curva veloce la sensazione di aderenza deve essere
  **migliore** rispetto a oggi (meno sottosterzo residuo se
  `F1_CORNERING_GRIP_MODEL` è anche attivo — altrimenti l'effetto è solo
  su `effectiveGrip`, più sottile: verificare entrambe le combinazioni,
  vedi Step 3).
- Gomma fresca: l'effetto deve essere appena percettibile (il baseline è
  già a capacità piena).

**Criteri di rollback:** stessa logica dello Step 1 su
`DOWNFORCE_CAPACITY_BONUS_MAX` (oggi 0.15)/`DOWNFORCE_EXPONENT` (oggi 2).

**ESITO (2026-07-28):** **bug reale trovato in playtest**, non un problema
di taratura — `effectiveGrip` moltiplicava `downforceFactor` invece di
dividerlo. `grip` in `applyGripBlend` è un coefficiente di lag (più alto =
più lenta la convergenza vx/vz verso il muso = più scivolata percepita,
non meno); moltiplicare per un fattore che cresce con la velocità
spingeva `grip` nella direzione SBAGLIATA, raddoppiando la divergenza
muso/traiettoria invece di ridurla. Causa confermata con simulazione a
freddo (sterzo pieno sostenuto, stessa fisica del server) prima di
correggere, come da processo di debug sistematico. Corretto in
`AerodynamicsModel.js` (`grip /= downforceFactor(...)`, non `*=`) — fix
localizzato, nessun cambio di architettura, `CorneringGripModel` non
toccato (lì l'uso era già corretto, dominio diverso). Dopo il fix,
confermato in playtest: feeling giudicato buono, nessuna correzione
ulteriore richiesta.

**Nota emersa durante il playtest (fuori scope, non toccata):** isolando
il solo blend `effectiveGrip`/`applyGripBlend`, l'usura gomme fa
CONVERGERE PIÙ IN FRETTA verso il muso (meno divergenza), non di più —
controintuitivo rispetto a "gomma usurata = meno aderente", ma la
sensazione complessiva di perdita aderenza in gioco arriva soprattutto da
`effectiveMaxSpeed`/`effectiveAccel` ridotti dall'usura, non da questo
meccanismo. Preesistente a questa fase (Fase 2B TyreForceModel, già
chiusa), non modificato: segnalato per eventuale indagine futura separata,
non parte di questo playtest.

## Step 3 — Drag + Downforce insieme (`F1_AERO_DRAG_MODEL=1 F1_AERO_DOWNFORCE_MODEL=1`)

Questa è la combinazione che rappresenta l'aerodinamica "di base" (sempre
presente, non legata a danno/scia) — probabilmente la prima a essere
promossa a default in futuro, se validata.

**Cosa provare:** un giro di gara completo, gomma che si usura
naturalmente, mescole diverse.

**Cosa cercare:**
- Le due sensazioni (meno top speed, più aderenza in curva veloce) devono
  convivere senza sembrare contraddittorie — es. non deve sembrare che
  l'auto sia "lenta ovunque" (se succede, il drag probabilmente pesa
  troppo rispetto al downforce).
- Provare anche con `F1_CORNERING_GRIP_MODEL=1` in aggiunta (fase
  precedente, già esistente): la downforce dovrebbe ridurre la frequenza
  con cui si innesca il sottosterzo progressivo ad alta velocità.

**Criteri di rollback:** se le due sensazioni sembrano scollegate o
contraddittorie, ritarare le costanti prima di aggiungere altro (non
introdurre nuovi assi/parametri).

## Step 4 — Danno aero sopra Drag+Downforce (`F1_AERO_DAMAGE_MODEL=1` in aggiunta)

**Richiede una gara con collisioni vere** (contro barriera o altra auto)
per generare danno a `frontWing`/`floor` — non osservabile in qualifica
(isolata, niente contatti) né senza urtare nulla.

**Cosa provare:** urtare deliberatamente una barriera (danno fondo/ala) o
un'altra auto, poi continuare il giro.

**Cosa cercare:**
- Dopo un urto che danneggia l'ala: top speed ulteriormente ridotta
  rispetto al solo drag da velocità (oltre al già esistente sottosterzo da
  `getFrontWingSteerPenalty`, invariato).
- Dopo un urto che danneggia il fondo: meno downforce, quindi meno
  aderenza in curva veloce rispetto al solo effetto velocità (oltre al già
  esistente `getFloorGripPenalty` meccanico).
- **Nota consapevole per chi testa:** con questo flag attivo, il danno
  all'ala smette di essere "isolato" allo sterzo (influenza anche il
  drag) — comportamento voluto di questa fase, non un bug se sembra
  strano rispetto all'abitudine precedente.

**Criteri di rollback:** se le due penalità aggiuntive (10% max ciascuna)
sono impercettibili sommate a quelle meccaniche esistenti (già fino al 35-
40%), valutare se aumentarle o se sono ridondanti — non introdurre un
quinto componente danno per differenziarle ulteriormente.

**ESITO (2026-07-28):** testato in gara con drag+downforce già attivi
(entrambi validati nei step precedenti), urto deliberato contro barriera.
Confermato senza riserve, nessuna correzione necessaria.

## Step 5 — Scia da sola (`F1_AERO_SLIPSTREAM_MODEL=1`, altri 3 spenti)

**Verifica di equivalenza, non di nuova sensazione**: a flag acceso la
scia deve sentirsi **esattamente come oggi** (stessa formula, solo
ricalcolata in un modulo diverso) — il playtest qui è una controprova che
la migrazione non abbia introdotto artefatti, non un tuning.

**Cosa provare:** seguire da vicino un'altra auto (bot) in gara, a distanze
diverse.

**Cosa cercare:** nessuna differenza percepita rispetto al comportamento
attuale della scia (flag spento). Se qualcosa sembra diverso, è un bug di
migrazione da investigare subito (non un tuning da fare).

**ESITO (2026-07-28):** confermata equivalenza, nessuna differenza
percepita. **Falso allarme durante il test:** sensazione di pattinamento
segnalata con solo questo flag attivo — verificato (processo unico in
esecuzione, nessun residuo, nessuna variabile in `.env`) e poi confermato
con una controprova diretta: la stessa sensazione è presente anche a
**zero flag attivi** (server riavviato senza alcuna env var). Confermato
quindi che è un comportamento preesistente del gioco (verosimilmente
collegato alla caratteristica del modello usura già annotata nello Step 2
— gomma fresca produce più divergenza muso/traiettoria, non meno — non
causato da nessuno dei 4 flag di questa fase). Nessuna azione necessaria.

## Step 6 — Tutti e 4 insieme

Solo dopo che gli Step 1-5 sono stati individualmente giudicati
soddisfacenti. Un giro di gara completo, gomme che si usurano, almeno un
urto deliberato per generare danno aero.

**Cosa cercare:** le sensazioni si sommano in modo coerente (nessuna
sembra "cancellare" o "raddoppiare" un'altra); nessun crash/comportamento
anomalo (già escluso a livello numerico dal checkpoint di integrazione,
ma la controprova umana in gioco reale resta necessaria).

## Esito complessivo (2026-07-28)

Eseguito un flag alla volta come richiesto (drag → downforce → danno →
scia, non la sequenza combinata Step 3/6 sopra — scope ridotto su
richiesta esplicita per questa sessione). Risultato:

| Flag | Esito | Note |
|---|---|---|
| `F1_AERO_DRAG_MODEL` | ✅ confermato | nessuna correzione |
| `F1_AERO_DOWNFORCE_MODEL` | ✅ confermato **dopo fix** | bug di segno trovato in playtest (`effectiveGrip` moltiplicava invece di dividere per `downforceFactor`, peggiorando la scivolata invece di ridurla) — corretto in `AerodynamicsModel.js`, verificato con simulazione a freddo prima e dopo |
| `F1_AERO_DAMAGE_MODEL` | ✅ confermato | testato con drag+downforce attivi, urto deliberato in gara |
| `F1_AERO_SLIPSTREAM_MODEL` | ✅ confermato | equivalenza con la formula storica verificata; un falso allarme (pattinamento) chiarito con controprova a zero flag — comportamento preesistente, non legato a questa fase |

**Nessun flag è stato promosso a default** — restano tutti spenti finché
l'utente non decide diversamente. Nessuna DRS implementata (fuori scope,
confermato). Nessun cambio architetturale: l'unica modifica di codice di
questa sessione è la correzione del segno in `AerodynamicsModel.js`
(Fase 2), non un refactor.

## Cosa NON fa questo piano

- Non decide se/quando promuovere alcun flag a default — resta una
  decisione dell'utente dopo ogni step.
- Non introduce DRS (Fase 5, punto di decisione futuro separato).
- Non prescrive nuove costanti/formule — solo dove guardare se quelle
  esistenti risultano da ritarare.
- Non richiede modifiche a `f1LapSimulator.js`/`f1RaceLineOptimizer.js`:
  la verifica end-to-end di questi flag è umana (gara vera, danno da
  collisione, scia da bot) — gli strumenti offline restano fuori scope
  qui, come già per le fasi precedenti (`F1_CORNERING_GRIP_MODEL`).
