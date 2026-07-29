# F1 — AerodynamicsModel: architettura del modulo aerodinamico — Design

## Contesto

Ricognizione preliminare (questa conversazione): `AerodynamicsModel.js` oggi
non modella nessun fenomeno aerodinamico. Contiene solo `effectiveGrip`
(mescola × usura via `TyreForceModel.corneringGripFactor` × danno fondo via
`DamageModel.getFloorGripPenalty`, **nessuna dipendenza da velocità**) e
`applyGripBlend` (il blend vx/vz verso la direzione del muso). Sono assenti:

- **Drag longitudinale**: nessuna forza resistente dipendente da `v`;
  l'unico "attrito" è `PowertrainModel.FRICTION`, costante per tick,
  indipendente dalla velocità.
- **Downforce**: nessun fattore di grip cresce con la velocità —
  `TyreForceModel.corneringGripFactor` dipende solo da `tyreWear`.
- **DRS**: assente in tutto il codebase.
- **Danno aerodinamico** come concetto separato dal danno meccanico già
  esistente su ala/fondo.

L'unico frammento aero-simile del gioco è la **scia (slipstream)**: un
moltiplicatore di `effectiveMaxSpeed` basato sulla vicinanza all'auto
davanti, calcolato interamente in `f1GameSocket.js` (righe ~875-886),
**fuori** da `backend/sockets/games/physics/` — un'incoerenza rispetto al
refactoring modulare di `docs/superpowers/plans/2026-07-27-f1-vehicle-dynamics-refactor.md`
(un modulo per formula, nessuna logica fisica nell'orchestratore).

**Questo documento non introduce ancora formule.** Fissa la decisione
architetturale (responsabilità, direzione delle dipendenze, confini) e la
sequenza di fasi in cui l'aerodinamica reale (drag, downforce, danno aero,
poi DRS) verrà innestata nei moduli esistenti — sullo stesso modello
incrementale già usato per `TyreForceModel`/`TyreSlipModel`/
`CorneringGripModel`.

## Decisione architetturale

### Cosa possiede `AerodynamicsModel`

- **`effectiveGrip`/`applyGripBlend`** — contratto pubblico invariato.
  Restano il **punto di combinazione finale** dei fattori che agiscono sul
  grip-blend (mescola, usura, danno fondo, e da questa fase anche un
  contributo aerodinamico) — ma `AerodynamicsModel` **non diventa il
  proprietario concettuale del grip totale**: è un combinatore che
  consulta fattori esterni (esattamente come fa oggi con
  `TyreForceModel.corneringGripFactor` e `DamageModel.getFloorGripPenalty`),
  non la fonte di verità di "quanto grip ha l'auto" in senso assoluto.
- **Un contributo aero alla capacità laterale (downforce)**, calcolato
  internamente in funzione della velocità (e, quando arriverà il danno
  aero, del danno ad ala/fondo) — esposto come funzione pura separata, non
  annegato invisibilmente dentro `effectiveGrip`. Questo stesso contributo
  è ciò che consultano sia `effectiveGrip` (per il proprio uso) sia
  `CorneringGripModel` (per il proprio, indipendentemente — vedi sotto).
- **Un fattore drag longitudinale**, concetto distinto dal contributo
  downforce sopra, per il tetto di velocità — consultato da
  `PowertrainModel.effectiveMaxSpeed`.
- **La formula pura della scia** (gap → fattore moltiplicativo): assorbe
  solo il *calcolo dell'effetto*, non la ricerca di chi sia l'auto davanti.

### Le due precisazioni vincolanti

1. **`AerodynamicsModel` non "possiede" il grip totale.** `effectiveGrip`
   resta il punto in cui i fattori (mescola/usura/danno fondo/aero) si
   combinano, ma la responsabilità aerodinamica in sé è un contributo
   separato e distinto, con la stessa dignità di `corneringGripFactor` o
   `getFloorGripPenalty` — non un concetto che assorbe o sostituisce gli
   altri.
2. **`CorneringGripModel` non consuma `effectiveGrip`.** Riceve/consulta
   direttamente il contributo aerodinamico dedicato alla capacità laterale
   da `AerodynamicsModel`, e lo combina da sé con
   `TyreForceModel.corneringGripFactor` (stessa forma di oggi, solo con un
   secondo input). Consumare `effectiveGrip` introdurrebbe un doppio
   conteggio (usura/danno già inclusi lì) e una dipendenza scorretta:
   `CorneringGripModel` deve restare, come oggi, un puro comparatore
   domanda/capacità, cieco a *da dove* arrivano i pezzi della capacità.

### Chi consulta `AerodynamicsModel` (nuovo)

| Modulo | Cosa consulta | Uso |
|---|---|---|
| `PowertrainModel` | fattore drag | dentro `effectiveMaxSpeed`, stesso schema con cui già consulta `DamageModel.getEnginePowerPenalty`/`TyreForceModel.tractionFactor` |
| `CorneringGripModel` | contributo aero alla capacità laterale | combinato con `TyreForceModel.corneringGripFactor` dentro `lateralExcess`, **non** tramite `effectiveGrip` |
| `f1GameSocket` | formula pura della scia | passa `gapM` già calcolato (nearestAheadPlayer resta suo) |

### Chi NON consulta `AerodynamicsModel` (confini invariati)

- **`SteeringModel`** — il sottosterzo da ala rotta (`getFrontWingSteerPenalty`)
  resta meccanico/strutturale, letto direttamente da `DamageModel`.
- **`VehicleMotionModel`** — il drag fuoripista (ghiaia) resta un concetto
  distinto, non aerodinamico.
- **`TyreForceModel`/`TyreModel`/`DamageModel`** — restano foglie pure:
  forniscono fattori/penalità, non consultano mai `AerodynamicsModel`.
  `DamageModel` guadagnerà nuovi getter di penalità aero (Fase 3, sotto),
  ma resta chi possiede lo *stato* del danno, non chi interpreta l'effetto
  aerodinamico.
- **`BrakingModel`** — nessuna relazione con l'aero, esplicitamente fuori
  scope (non deciso né per ora né per il futuro).

### Direzione delle dipendenze (nessun ciclo)

```
DamageModel / TyreModel / TyreForceModel      (stato + fattori puri, foglie)
        ↑
AerodynamicsModel   (fattore drag, contributo downforce, formula scia — combina wear/damage/velocità)
        ↑                              ↑
PowertrainModel            CorneringGripModel   (ciascuno consulta solo il proprio contributo,
        ↑                              ↑         MAI l'un l'altro, mai via effectiveGrip)
        └──────────────┬───────────────┘
                 VehiclePhysics   (orchestratore, ordine di chiamata invariato)
                        ↑
                 f1GameSocket   (contesto di gara: gap, loop, quali/gara)
```

Nessuna dipendenza tra moduli fratelli (`PowertrainModel` non importa mai
`CorneringGripModel` né viceversa) — stesso principio già in vigore da
`docs/superpowers/plans/2026-07-27-f1-vehicle-dynamics-refactor.md`.

## Interfaccia proposta (nomi concettuali, non formule)

Le firme esatte e i nomi definitivi si decidono in fase di implementazione
(Fase 0/1 sotto, stesso approccio già usato per `TyreForceModel`); qui si
fissa solo *quali* funzioni pure devono esistere e chi le consulta:

| Funzione (concettuale) | Modulo proprietario | Consultata da |
|---|---|---|
| `effectiveGrip(p, isQuali)` | `AerodynamicsModel` (invariata nel contratto) | `VehiclePhysics` (invariato) |
| contributo downforce (capacità laterale, funzione di velocità, poi danno) | `AerodynamicsModel` (nuova) | `effectiveGrip` internamente **e** `CorneringGripModel` (due consumer indipendenti dello stesso contributo) |
| fattore drag longitudinale (funzione di velocità, poi danno) | `AerodynamicsModel` (nuova) | `PowertrainModel.effectiveMaxSpeed` |
| formula scia (funzione di `gapM`) | `AerodynamicsModel` (nuova, migrata da `f1GameSocket`) | `f1GameSocket` |
| penalità aero da danno (es. più drag da ala rotta, meno downforce da fondo rotto) | `DamageModel` (nuovi getter, riusa `frontWing`/`floor`) | `AerodynamicsModel` internamente (fattore drag e contributo downforce, separatamente) |

## Roadmap incrementale (Fase Aero)

Stessa disciplina delle fasi precedenti: ogni fase lascia il gioco
funzionante, dietro flag di confronto dove sensato, nessuna promozione a
default senza playtest esplicito.

### Fase 0 — Seam architetturale

Aggiungere a `AerodynamicsModel.js` le nuove funzioni pure (contributo
downforce, fattore drag, formula scia) con un'implementazione placeholder
neutra (fattore = 1, nessun effetto). Nessun consumer esistente le chiama
ancora. `DamageModel` resta **invariato** in questa fase — i getter di
penalità aero si aggiungono solo in Fase 3, quando servono davvero, non
prima. Zero comportamento cambiato — puro posizionamento del seam, come la
Fase 0 di `TyreForceModel`.

### Fase 1 — Drag

`PowertrainModel.effectiveMaxSpeed` consulta il drag factor di
`AerodynamicsModel` (ancora a fattore neutro finché non tarato), dietro
flag di confronto. Formula, costanti e curva velocità→drag si decidono
qui, non in questo documento. Validazione con `f1LapSimulator`.

### Fase 2 — Downforce

`effectiveGrip` consulta il contributo downforce (ora reso velocity-aware)
come fattore aggiuntivo. `CorneringGripModel.lateralExcess` consulta lo
**stesso contributo** direttamente da `AerodynamicsModel` e lo combina con
`TyreForceModel.corneringGripFactor` — non passa da `effectiveGrip`.
Playtest dedicato: a velocità alta, meno rischio di eccesso laterale
rispetto a oggi, a parità di usura.

**Nota vincolante sul doppio conteggio:** il contributo downforce è
un'**unica funzione pura con due consumer indipendenti** —
`effectiveGrip`/`applyGripBlend` (comportamento generale del blend) e
`CorneringGripModel.lateralExcess` (confronto domanda/capacità laterale).
I due consumer **non si moltiplicano tra loro né uno legge l'output
dell'altro**: ciascuno chiama la funzione downforce da sé e la combina
internamente con i propri altri fattori (`effectiveGrip` con
mescola/usura/danno fondo; `CorneringGripModel` con
`TyreForceModel.corneringGripFactor`). Nessun percorso in cui l'output di
uno dei due diventi input dell'altro.

### Fase 3 — Danno aerodinamico

`DamageModel` guadagna i getter di penalità aero (drag da ala rotta,
perdita downforce da fondo rotto), riusando i componenti `frontWing`/
`floor` già esistenti — nessun quinto componente. `AerodynamicsModel` li
consulta internamente nel fattore drag e nel contributo downforce,
separatamente, con lo stesso schema con cui `effectiveGrip` consulta oggi
`getFloorGripPenalty`.

### Fase 4 — Migrazione della scia

`f1GameSocket.js` smette di calcolare inline `slipstreamMult`: consulta la
formula pura in `AerodynamicsModel`, passandole `gapM` già calcolato da
`nearestAheadPlayer`. La ricerca del gap, il loop sui `racing`,
l'esclusione in qualifica e il flag visivo `inSlipstream` restano in
`f1GameSocket`. La plumbing esatta di come questo fattore si combina col
drag dentro `effectiveMaxSpeed` (oggi `slipstreamMult` è un parametro
esterno moltiplicato fuori da `effectiveMaxSpeed`) è una decisione
implementativa di questa fase, non di questo documento.

### Fase 5 — DRS (punto di decisione futuro, non pianificato qui)

Stato per-player (zona attiva, disponibilità), effetto sul drag factor
esistente. Nessun dettaglio deciso in questo documento — richiede un
documento a parte dopo che Fase 1/4 sono validate.

## Stato finale — checkpoint (2026-07-28)

**Milestone chiusa: Fasi 0-4 implementate, testate, nessuna attivata di
default.** Fase 5 (DRS) esplicitamente non iniziata, resta un punto di
decisione futuro.

### Cosa esiste oggi

| Fase | Flag | Formula reale | Consultato da |
|---|---|---|---|
| 1 — Drag | `F1_AERO_DRAG_MODEL` | `dragFactor(speedFrac, isQuali, damageParts)` = `1 - speedFrac²×0.05`, poi ×`(1-getFrontWingDragPenalty)` se Fase 3 attiva | `PowertrainModel.effectiveMaxSpeed` |
| 2 — Downforce | `F1_AERO_DOWNFORCE_MODEL` | `downforceFactor(speedFrac, isQuali, damageParts)` = `1 + speedFrac²×0.15`, poi ×`(1-getFloorDownforcePenalty)` se Fase 3 attiva | `effectiveGrip` (proprio percorso) **e** `CorneringGripModel.lateralExcess` (percorso indipendente, mai via `effectiveGrip`) |
| 3 — Danno aero | `F1_AERO_DAMAGE_MODEL` | `DamageModel.getFrontWingDragPenalty`/`getFloorDownforcePenalty` (0..10%, riusano `frontWing`/`floor`) | `dragFactor`/`downforceFactor` internamente — **nessun effetto se Fase 1/2 sono spente** |
| 4 — Scia | `F1_AERO_SLIPSTREAM_MODEL` | `slipstreamFactor(gapM)` = formula storica invariata (`SLIPSTREAM_RANGE_M=25`, `SLIPSTREAM_MAX_BOOST=0.08`) | `f1GameSocket.computeSlipstreamMult` (ricerca gap/loop/esclusione quali restano in `f1GameSocket`) |

Tutti i flag: **spenti di default**, letti esclusivamente dentro
`AerodynamicsModel.js` (`process.env.F1_AERO_X === '1'`, stesso pattern
per tutti e 4). Riferimento centralizzato: `docs/f1-notes.md` (tabella
flag aggiunta in questo checkpoint — prima non esisteva un elenco unico).

### Verifica di integrazione tra i 4 flag (questo checkpoint)

Eseguito uno sweep numerico (288 combinazioni: velocità × usura × danno ×
mescola × qualifica/gara) e la suite completa con **tutti e 4 i flag
attivi insieme**: nessun NaN, nessun valore negativo o infinito — la
composizione matematica è sicura (le penalità/bonus sono percentuali
piccole, 5-15%, nessuna combinazione le porta a incrociare zero).

Un solo effetto di interazione reale trovato, **atteso e voluto**: il test
storico `f1GameSocket.physics.test.js` "Simcade: isolamento dei
componenti" assume che il danno all'ala anteriore influenzi SOLO lo sterzo
e mai la velocità massima — vero di default (flag spenti), ma **non più
vero** con `F1_AERO_DRAG_MODEL` + `F1_AERO_DAMAGE_MODEL` entrambi attivi:
l'ala rotta allora aumenta anche il drag (per design, Fase 3). Non è un
bug: è la conseguenza intenzionale di Fase 3, solo il test presupponeva
implicitamente "flag spenti" senza dichiararlo. Nessuna correzione fatta
(fuori scope per questo checkpoint — non refactoring/ottimizzazioni),
segnalato qui per chi playtesterà `F1_AERO_DAMAGE_MODEL`.

Gli altri fallimenti osservati forzando tutti i flag insieme sono
artefatti del metodo di verifica (test che asseriscono `process.env.X ===
undefined` come precondizione, o valori hardcoded di baseline che
cambiano legittimamente quando i flag sono attivi) — non bug.

### Cosa NON è stato fatto (deliberatamente, per restare nello scope)

- Nessun flag promosso a default-on.
- Nessun playtest umano ancora eseguito (vedi piano playtest a parte).
- Nessuna DRS (Fase 5).
- Nessun refactor/ottimizzazione oltre a quanto richiesto da ciascuna fase.

## Cosa NON fa questo documento

- Non definisce formule, costanti o curve per drag/downforce/scia/danno
  aero — materia delle singole fasi.
- Non tocca `SteeringModel`, `VehicleMotionModel`, `BrakingModel`,
  `TyreForceModel`, `TyreModel` come struttura.
- Non introduce DRS in dettaglio — solo un punto di decisione futuro
  esplicitamente rimandato.
- Non decide la plumbing esatta della migrazione scia (Fase 4) — solo il
  confine di responsabilità (formula in `AerodynamicsModel`, ricerca gap in
  `f1GameSocket`).
- Non contiene codice.
