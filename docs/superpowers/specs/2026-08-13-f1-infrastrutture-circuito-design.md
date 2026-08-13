# F1 — infrastrutture di circuito: riempire le zone vuote

Spec del 2026-08-13. Nasce dalla richiesta dell'utente dopo il playtest della
scenografia più densa (`14eee0c`): «ci sono ancora un po' di zone del circuito
che possono essere riempite… magari potremmo generare dei nuovi asset come per
esempio maxischermi… vorrei che diventassero infrastrutture del circuito».

Riferimenti: `docs/superpowers/specs/2026-08-13-f1-scenografia-sul-muro-vero-design.md`
(la scenografia allineata al muro, di cui questo lavoro riusa tutti i vincoli),
`docs/f1-notes.md` § "Asset voxel del circuito" (pipeline e convenzioni).

## Il problema, misurato

Il criterio: un tratto di pista è **vuoto** se non ha nessuna struttura
costruita entro 90 unità dall'asse e 60 lungo la pista. Su `prova`:

| lato | vuoto totale | tratti più lunghi |
|---|---|---|
| destro | 1706 di 5170 unità (33%) | 409-605 (1018 u, **189 campioni su viadotto**), 150-200 (264 u), 805-845 (212 u) |
| sinistro | 2192 di 5170 unità (42%) | 543-697 (801 u, 72 su viadotto), 886-946 (315 u), 305-362 (300 u), 195-251 (295 u), 471-517 (243 u), 751-779 (150 u) |

L'utente ha poi segnato dodici punti in gioco (segnalazioni M 24-35, campioni
262, 390, 564, 593, 682, 696, 718, 747, 827, 904, 924, 954). **Undici su
dodici cadono dentro o al bordo dei tratti misurati**: il criterio automatico e
l'occhio dell'utente vedono la stessa cosa. In tutti, l'oggetto costruito più
vicino sta a 40-60 unità e in mezzo ci sono solo alberi.

Due cause distinte:

1. **Le curve.** Una fila di tribune è rigida e non segue una curva stretta:
   quasi tutti i tratti vuoti girano di 63-130°. Gli asset di questa spec sono
   oggetti **singoli**, quindi entrano dove una fila non entra. È la ragione
   per cui l'algoritmo può essere una semplice camminata invece di un
   riempitore di buchi.
2. **Il viadotto.** I campioni 417-614 di `prova` (il 20% del giro) sono
   sopraelevati fino a **11.5 unità** sopra il terreno. Qualunque cosa più
   bassa di così, messa di fianco, sprofonda fuori dalla vista di chi guida.
   Due dei punti segnati dall'utente (26 @564 e 27 @593) sono lì.

## Scelte già prese, e perché

**Approccio: una passata sola che cammina il giro** (scelto fra tre).
Le alternative scartate: una regola per famiglia dentro `sceneryTrackside.js`
(è la stessa logica che i buchi li ha prodotti, e non garantisce niente); e un
riempitore esplicito che misura i vuoti e li tappa (introduce il concetto di
"buco" da mantenere per sempre, e rischia di mettere una gru in mezzo a un
rettilineo pur di chiudere un vuoto).

⚠️ **La misura dei vuoti non entra nell'algoritmo, entra nei test.** Il codice
posa dove c'è posto; è il test a pretendere che alla fine nessun tratto lungo
resti spoglio. Se un domani cambia la densità delle tribune, un test lo dice
mentre un'euristica si adatterebbe in silenzio.

**«VIP» è uno stile, non un posto.** Nel dubbio iniziale la zona VIP sembrava
un gruppo coerente da piazzare in un punto solo; l'utente ha chiarito che vuole
singoli asset distribuiti come le tribune, con un'architettura più lussuosa.
Quindi `vipSuite` è una variante di `hospitalityDeck`, non un sottosistema.

**Strutture oltre il muro della via di fuga: accettate.** In curva il muro
arretra fino a 34.5 unità e gli oggetti finiscono lontani dall'asse. L'utente
ha valutato e accettato: «va bene lasciare stare e mantenere tutto come mi hai
detto».

**Un asset in meno rispetto alla proposta iniziale.** La "cartellonistica
continua" non si modella: `banner` esiste già ed è distribuito su tutto il giro
a lati alterni ogni 170 unità (`sceneryPaddock.js`). Il modulo nuovo lo
infittisce dove non entra altro. Zero modellazione, riempimento vero.

## Architettura

### Dove si innesta

`frontend/shared/sceneryInfrastructure.js`, modulo puro — nessuna dipendenza da
Three, quindi verificabile con `node --test` come gli altri moduli di
scenografia.

In `trackScenery.js::generateLayout` l'ordine diventa:

```
paddock → tribuna principale → tribune → landmark → trackside
        → INFRASTRUTTURE ← qui
        → natura → boschi → rocce → folla
```

Dopo il trackside, così vede tribune, reti, gomme e landmark già posati; prima
della natura, così sono gli alberi a scansarsi da lui e non viceversa. I suoi
oggetti entrano in `accepted` prima della natura.

### Il contratto

- **Categoria** `infrastructure`, nuova.
- **`suMisuraSulMuro: true`** su ogni voce: nascono già alla distanza giusta dal
  muro, e senza il flag `traslaOltreLaGhiaia` li sposterebbe una seconda volta.
- **RNG proprio**, `mulberry32(hashString(id + ':infra'))`. Non è un dettaglio:
  il 2026-08-13 la fittezza dei boschi dipendeva da quante tribune c'erano a
  monte, attraverso la sequenza condivisa, e ha fatto fallire un test senza che
  un solo albero avesse cambiato posto per un motivo geometrico.

### I sette vincoli

Nessuno è nuovo tranne il settimo: sono i vincoli che i playtest precedenti
hanno già pagato, estesi ai nuovi asset.

1. **Mai nella via di fuga** — controllo sui quattro angoli dell'ingombro,
   ciascuno contro il muro del campione più vicino a quell'angolo
   (`TrackGravel.barrierAt`). Il campione del centro non basta: il muro cambia
   sotto l'oggetto.
2. **Mai dentro un'altra struttura** — `SceneryAssetSizes.itemsOverlap` contro
   `accepted` e contro ciò che il modulo ha già posato. Ingombro reale
   orientato, mai una distanza fra centri.
3. **Mai nella corsia box né sui box giocatore** — `nearestPoint(pitPts)` e
   `insidePlayerBoxFootprint`.
4. **Mai sotto una campata né sotto un cavalcavia** — `spanning` e
   `fitsUnderBridge`, con l'altezza SCALATA dell'oggetto.
5. **Mai nella fascia davanti a una tribuna** — la stessa fascia larga quanto
   la tribuna e profonda 22 unità introdotta il 2026-08-13.
6. **Deve guardare la pista che ha davanti** —
   `trackScenery.js::guardaLaSuaPista`, scarto massimo 30° dalla perpendicolare
   al campione **più vicino**. Va estratto in un punto raggiungibile da
   entrambi i moduli.
7. **Accanto a un tratto sopraelevato, solo se più alto del dislivello.**
   `altezza(asset) > trackPts[idx].y - terrainHeightAt(...)`, misurato al
   campione. Su `prova` il dislivello arriva a 11.5.

### L'algoritmo

Una camminata sola, a passo fisso **in unità di pista, mai in campioni**. È
l'errore che in questo progetto è già costato quattro round: il campione vale
5.17 unità su `prova`, 3.21 su `new-monza`, 1.18 su `monte-rosso`, 2.71 su
`baku`, quindi una soglia "in campioni" ha quattro comportamenti diversi.

Per ogni punto della camminata e per ciascuno dei due lati:

1. **Leggi il contesto**: curva o rettilineo (`SceneryTrackside.findCorners` —
   ⚠️ il suo `side` è il lato **ESTERNO**), sopraelevazione e suo dislivello,
   distanza del muro, lunghezza della visuale davanti, distanza dalla corsia
   box.
2. **Ordina la palette** per quel contesto, come **lista di preferenza** e non
   come scelta unica: se il primo non entra si prova il secondo, invece di
   lasciare un buco.
3. **Prova a posare** il primo che passa tutti e sette i vincoli.
4. **Rispetta le spaziature**: una minima per famiglia (le gru non si
   ammucchiano, i maxischermi non si vedono a due a due) e una globale, perché
   l'infrastruttura riempia senza diventare una fila continua.
5. Se non entra niente, **si va avanti**. Nessun ripiego forzato.

## La palette

Otto modelli nuovi. Dimensioni in unità di gioco (1 unità ≈ 0.78 m; per
riferimento la tribuna è 19.2 × 12.3 × 12.8 e l'auto è larga 3.47). Sono
indicative: i valori veri si misurano sui `.glb` esportati e si scrivono in
`sceneryAssetSizes.js`.

| asset | ~L × A × P | ruolo e contesto |
|---|---|---|
| `giantScreen` | 16 × 18 × 4 | Maxischermo su traliccio. Dove la visuale è lunga: rettilinei, uscite di curva. Uno ogni ~1000 unità, mai due in vista. Alto 18 → ammesso accanto al viadotto. |
| `floodlightTower` | 5 × 30 × 5 | Torre faro. Ovunque, con **priorità accanto ai tratti sopraelevati**: sottile, entra dove non entra altro, e a 30 si vede da sopra il viadotto. |
| `serviceBuilding` | 14 × 15 × 11 | Torre servizi/cronometraggio. Tratti dritti lontani dal traguardo, dove serve un volume che spezzi la fila di alberi. |
| `hospitalityDeck` | 15 × 9 × 11 | Terrazza su pilastri, tetto piano, ringhiera. **Esterno curva**: è il pezzo che risolve il problema strutturale, perché è singolo. Porta spettatori in piedi. |
| `vipSuite` | 16 × 13 × 12 | Stesso ruolo, stile di lusso: vetrate, terrazza sul tetto con verde e ombrelloni, insegna. Più rara, nelle posizioni migliori. |
| `tvTower` | 4.5 × 13 × 4.5 | Torretta TV a traliccio con cabina. Esterno curva, dove inquadra l'ingresso. |
| `recoveryCrane` | 7 × 15 × 14 | Gru di recupero gialla col braccio. Esterno curva, dietro le gomme. |
| `trackGate` | 9 × 5 × 3 | Varco nella barriera con cancello a rete. A intervalli. **Basso: mai accanto al viadotto.** |

**Riuso, senza modellare niente**: `banner` e `billboardLow` come riempimento
economico dove non entra altro; `flagPole` (15 alto) e `pylon` (26 alto, è un
pylon pubblicitario) come verticali; `spectatorStandA`/`spectatorStandB` sopra
le terrazze e le suite.

### Ordine di preferenza per contesto

| contesto | preferenza |
|---|---|
| esterno curva | `recoveryCrane`, `tvTower`, `hospitalityDeck`, `vipSuite`, `banner` |
| rettilineo con visuale | `giantScreen`, `serviceBuilding`, `floodlightTower`, `billboardLow` |
| accanto al viadotto | `floodlightTower`, `giantScreen`, `tvTower` — e nient'altro |
| tratto stretto, muro sottile | `trackGate`, `flagPole`, `banner` |
| niente entra | si prosegue |

`prova` ha 13 curve rilevate, `baku` 10, `new-monza` 6, `monte-rosso` 4: il
contesto "esterno curva" è abbondante sui tracciati che ne hanno bisogno.

### Spettatori sulle terrazze

`hospitalityDeck` e `vipSuite` ospitano `spectatorStandA`/`spectatorStandB`,
già caricati e già esclusi da ombre e contorni. Le ancore dei posti seguono lo
stesso schema di `grandStandSeats.json`: coordinate **locali all'asset**,
generate dallo stesso builder che modella la pedana, e portate in coordinate
mondo applicando rotazione e posizione — la convenzione che ha risolto i 2394
spettatori staccati dai gradoni.

⚠️ **La folla delle terrazze ha un budget SEPARATO da quello delle tribune.**
`SceneryCrowd.MAX_TOTAL = 6000` non è un numero di figure che si vede: è un
budget spalmato su tutte le tribune del circuito, quindi se le terrazze
pescassero dallo stesso tetto svuoterebbero le tribune — è esattamente
l'errore già commesso il 2026-08-13, quando raddoppiare le tribune senza
alzare il tetto le ha portate da 54 a 26 spettatori l'una. Le figure delle
terrazze si contano a parte, con un tetto proprio dimensionato sul numero di
terrazze (indicativamente 10-12 figure per terrazza), e `MAX_TOTAL` resta
intatto.

## Verifica

### Il test che dà il nome al lavoro

La misura dei vuoti diventa codice di test: per ogni lato si trovano i tratti
senza nessuna struttura entro 90 unità dall'asse e 60 lungo la pista, e si
pretende che il più lungo — **escluso il viadotto, che ha regole sue** — stia
sotto una soglia.

Numeri di partenza su `prova`: peggiore non-viadotto **315 unità**, vuoto
totale **33%** a destra e **42%** a sinistra.

**L'obiettivo dichiarato è dimezzarli.** La soglia esatta si fissa quando ci
sono i numeri veri del modulo. ⚠️ Se non ci si arriva, è il piano a essere
sbagliato e va detto — non la soglia ad abbassarsi per far passare il test.

### Gli invarianti

Uno per vincolo, su tutti e quattro i tracciati, sul modello dei test già
scritti per le tribune:

- nessuna infrastruttura dentro un'altra struttura;
- nessun angolo di infrastruttura dentro la via di fuga;
- niente sotto una campata o un cavalcavia;
- niente nella fascia davanti a una tribuna;
- ogni infrastruttura guarda la pista entro 30°;
- **ogni oggetto accanto a un tratto sopraelevato è più alto del dislivello
  locale** (l'unico vincolo nuovo);
- stesso tracciato → stesso layout (determinismo dell'RNG seedato).

### Il costo

Stima a spanne, da confermare con i modelli veri:

| | stima |
|---|---|
| istanze nuove su `prova` | ~85 strutture + ~130 spettatori in piedi |
| triangoli nuovi | **~60k**, contro 1661k attuali → **+4%** |
| `InstancedMesh` nuovi | ~100-120, contro 668 attuali → **+18%** |

Il triangolo non è il problema: questi asset sono un ordine di grandezza più
leggeri di una tribuna (3744) o di un muro di gomme (2160). **Il costo vero
sono le draw call**, perché ogni asset aggiunge un `InstancedMesh` per ogni suo
materiale in ogni cella che occupa.

Conseguenze, che sono vincoli di progetto e non consigli:

- **Tre o quattro materiali per asset, non sei.** Il tetto di sei resta quello
  duro di `kit.finish()`, ma su otto asset distribuiti la differenza fra
  quattro e sei sono ~40 draw call.
- `floodlightTower` va in `NO_SHADOW_ASSETS`: un traliccio sottile costa in
  shadow map quanto un edificio e la sua ombra non si legge.
- Nuovo strumento `backend/tools/f1-costo-scenografia.js`: stampa istanze,
  `InstancedMesh` e triangoli per categoria e per asset, leggendo i `.glb`
  veri. Il budget si controlla da riga di comando invece che a occhio col
  pannello F9.

## Pipeline degli asset

Quella già collaudata (`docs/f1-notes.md` § "Asset voxel del circuito"):

- un modulo nuovo `backend/tools/circuitAssets/infrastructure.py`, registrato
  in `circuitAssets/__init__.py`;
- invarianti geometrici in `backend/tools/circuitAssets.test.js`;
- `circuitAssetsBlackCheck.py` dopo **ogni** modifica alla geometria: è il
  controllo che ha pescato quasi tutti i difetti di modellazione;
- le convenzioni non ovvie valgono tutte: scala 1:1 in unità di gioco, fronte
  verso +Z gioco, pivot alla base e centrato in XZ, niente volumi cavi, niente
  facce complanari sovrapposte;
- `hospitalityDeck` e `vipSuite` condividono impianto e ingombro e vanno
  costruite vicine, così la variante di lusso è davvero una variante.

⚠️ **Gate di approvazione**: i render vanno approvati dall'utente **a lotti,
prima** di cablare qualsiasi cosa in gioco. È una regola che questo progetto si
è già dato dopo un asset bocciato a integrazione fatta.

## Fuori scopo

- La **densità delle tribune**: appena ritarata (`f207f84`), non si tocca.
- Il **paesaggio lontano** (cascine, capannoni, tralicci sull'orizzonte):
  l'utente ha scelto "infrastrutture lungo la strada", non paesaggio.
- Il **pubblico informale** sulle collinette: valutato e non scelto.
- Qualunque nuova **regola di piazzamento delle tribune**: questa spec aggiunge
  una categoria, non ne rivede una esistente.
