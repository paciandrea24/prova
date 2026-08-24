# F1 — Bug di scenografia, la cura alla radice (blocco C)

**Data**: 2026-08-24
**Blocco**: C della scomposizione concordata il 2026-08-23
**Prerequisito**: blocco B (mappe immutabili) — `prova` è congelata, quindi
tutto ciò che segue **non la tocca**. È esattamente il motivo per cui il
blocco B veniva prima.

## Il vincolo che decide tutto

Dettato dall'utente il 2026-08-24, testualmente:

> «quello che io voglio è non avere più questi bug in una qualsiasi possibile
> pista che posso creare. non devono essere modifiche mirate a questi
> circuiti. devono essere delle modifiche che risolvono questi problemi alla
> radice. altrimenti io poi creo una nuova pista e ho di nuovo lo stesso
> problema.»

Quindi il criterio di successo **non** è «melbourne è a posto». È: *una pista
disegnata domani, che nessuno ha mai visto, non può presentare questi
difetti* — perché non esiste più una strada nel codice che li produca.

Questo esclude in partenza le liste di eccezioni, le soglie tarate su un
circuito e i ritocchi di coordinate.

## Cosa è stato riprodotto (misure, non impressioni)

Sonda headless su tutte le piste, ingombro **orientato** (SAT), non distanza
fra i centri.

| # | Difetto | Dove, con che numero |
|---|---|---|
| 1 | Asset dentro la carreggiata | `melbourne`: motorhome dentro di **10,8 unità**. `monte-rosso`: 4 containerStack fino a **5,9** |
| 2 | Roba dentro la corsia box | `new-monza`: il ponte semafori entra di **5,3**. `melbourne`: 6 fra uffici e garage, fino a **4,3** |
| 3 | Oggetti dentro le tribune | `melbourne`/`new-monza`: banner dentro una tribuna fino a **5,6**; pylon **3,0**; motorhome **3,1** |
| 4 | Ponte dei semafori lontano dalla griglia | atteso 75 unità. `shanghai` **135**, `melbourne` **226** |
| 5 | Tribune senza rete | `melbourne` **15 su 110 (14%)**, `shanghai` 4, `new-monza` 2 |

`prova`, `monte-rosso` e `suzuka` sono pulite sul punto 5; `prova` lo è anche
sul 4. È il motivo per cui il difetto è passato inosservato: **sulle piste
vecchie non si vede.**

Il sesto difetto riferito — *buchi d'erba dove una zona sopraelevata incontra
un ponte* — **non è qui dentro**: appartiene alla mesh del terreno
(`trackMeshBuilder.buildGround` / `buildBridgeDecks`), non al piazzamento
della scenografia, e va affrontato separatamente. Misurato: solo `prova`,
`prova-notturno` e `suzuka` hanno la configurazione che lo può produrre
(ponte a meno di 10 campioni da un tratto sopraelevato). Il confronto fra
quota della pista e quota del prato ai confini di ponte **non mostra salti**,
quindi la causa non è la quota: serve vederlo. ⚠️ Nota: il congelamento di
`prova` copre la **scenografia**, non il terreno — quindi una correzione al
terreno cambierà anche `prova`.

## La causa comune dei difetti 1, 2, 3

Non sono tre bug: è **uno**, visto da tre angoli.

`trackScenery.generateLayout` costruisce la scenografia in dodici passaggi e
si passa fra loro una lista `accepted` — «ciò che è già stato piazzato»,
contro cui ogni costruttore dovrebbe controllare. Il meccanismo esiste. Ma il
registro è **incompleto**:

```js
const accepted  = [...paddock, ...mainStand];
const grandstand = buildGrandstandLayout(..., accepted, ...);
//  ⟵ le tribune non entrano MAI in `accepted`
accepted.push(...landmarks);
accepted.push(...trackside.filter(v => v.category === 'paddock-decor'));
//  ⟵ di trackside entra solo un quinto: gomme, reti, cartelli, commissari
//     e barriere non entrano
const nature     = buildNatureLayout(..., accepted, ...);   // ⟵ non entra
const paddockLife = SceneryPaddock.buildLayout(..., accepted, ...);   // ⟵ non entra
const woods      = buildWoodsLayout(...);                   // ⟵ non entra
```

Da qui, meccanicamente:

- **il banner dentro la tribuna** — `paddockLife` gira dopo le tribune e non
  le vede;
- **il pylon dentro la tribuna** — idem per `paddock-decor`;
- **gli alberi dentro gli alberi** — `nature` e `woods` non si registrano,
  quindi non vedono nemmeno se stessi fra due chiamate;
- **le gomme dentro le gomme** — `safety` non entra nel registro.

E il **corridoio** (carreggiata + corsia box) non è nel registro affatto: ogni
costruttore se lo ricontrolla per conto proprio, con criteri diversi — chi con
una distanza, chi con un raggio, chi non lo controlla. Da lì il motorhome in
pista e i garage dentro la corsia box.

**La radice è che esiste più di una strada per entrare nel layout.** Finché un
costruttore può fare `layout.push(...)` senza chiedere niente, ogni asset
nuovo e ogni pista nuova possono riaprire il difetto. Oggi su cinque moduli
solo uno (`sceneryLandmarks`) consulta davvero l'indice delle collisioni.

## La cura: una sola porta

Un modulo `sceneryRegistro.js` che possiede **contemporaneamente** il corridoio
e ciò che è già a terra, ed espone una sola operazione:

```js
const reg = SceneryRegistro.crea({ trackPts, pitPts, roadHalf, pitRoadHalf, playerBoxFootprints });
reg.posa(item)   // -> true se piazzato (e registrato), false con il motivo
```

`posa` rifiuta se l'ingombro orientato dell'oggetto:
1. entra nella carreggiata o nella corsia box (oltre una tolleranza dichiarata);
2. entra in un box giocatore;
3. si compenetra con qualcosa di già posato oltre la soglia.

E — questo è il punto — **registra** ciò che accetta. Il registro non è più una
lista che qualcuno si ricorda di aggiornare: è la conseguenza dell'aver
piazzato.

Perché questo soddisfa il vincolo dell'utente: dopo la migrazione **non esiste
una strada nel layout che non passi da `posa`**. Un asset nuovo, un modulo
nuovo, una pista nuova: o passano di lì, o non sono nella scenografia.

### Le due decisioni da non sbagliare

**Le soglie si esprimono in unità di pista, mai in campioni.** Un campione vale
1,18 unità su monte-rosso e 5,17 su prova: una soglia «per campione» darebbe
comportamenti diversi su ogni circuito, che è precisamente il difetto che
stiamo togliendo. (Lezione già pagata su questo progetto.)

**L'ingombro è orientato, sempre.** `SceneryAssetSizes.itemsOverlap` esiste già
e fa il test SAT giusto; il raggio circolare va usato solo come pre-filtro
della griglia spaziale, mai come criterio.

### Cosa NON fa la porta

Non decide *dove* mettere le cose: quello resta di ogni costruttore, che
conosce il proprio criterio (curvatura, lato, ritmo). La porta dice solo sì o
no, e ricorda. Separare le due cose è ciò che rende la migrazione fattibile un
modulo alla volta invece che in un big bang.

## I difetti 4 e 5 hanno una radice propria

Sono due casi dello stesso schema — **una `continue` che scarta in silenzio** —
ma le cure sono diverse.

### 4. Il ponte dei semafori

```js
for (let d = 0; d < 200; d += 4) {
    ...
    if (!freeOf('startGantry', cand, cand.scale)) continue;   // avanza e riprova
}
```

Cerca un posto libero avanzando **fino a 200 campioni** e antepone «libero» a
«vicino alla partenza». Su melbourne è scivolato in avanti di 48 campioni, cioè
226 unità invece di 75. Il commento sopra quel ciclo dice l'esatto contrario di
ciò che il codice fa:

> «meglio un gantry che sfiora una tribuna che una gara senza semaforo»

**Cura:** la ricerca si ferma a una distanza dichiarata dalla griglia (in unità
di pista), e se dentro quella finestra non c'è posto **si posa comunque nella
posizione ideale**, che è ciò che il commento già prometteva. Il gantry porta i
semafori di partenza: la sua posizione rispetto alla griglia non è
negoziabile, la sua pulizia sì.

### 5. Le tribune senza rete

La rete **nasce** dalla tribuna (stesso centro, stessa rotazione, scala
derivata): il meccanismo è giusto. Ma tre `continue` la fanno sparire — tratto
di ponte, `usable()` negativo, sovrapposizione con un'altra tribuna — e la
tribuna resta lì, scoperta. Il difetto non è che la rete manchi: è che
**tribuna e rete possano esistere separatamente**.

**Cura:** diventano un'unica decisione. Se la rete di una tribuna non si può
posare, non si posa **nemmeno la tribuna**: una tribuna in meno non la nota
nessuno, una tribuna sulla pista senza protezione sì. Invariante:
`#reti == #posizioni-di-tribuna`, su ogni pista.

## Come si verifica — ed è la parte che vale più delle correzioni

Un test che **enumera la cartella delle piste** e, per ognuna, genera il layout
e pretende:

1. zero oggetti dentro la carreggiata;
2. zero oggetti dentro la corsia box;
3. zero compenetrazioni oltre la soglia;
4. il ponte dei semafori entro la finestra dichiarata dalla griglia;
5. ogni posizione di tribuna ha la sua rete.

Enumerando la cartella, **ogni pista che l'utente creerà d'ora in poi è coperta
il giorno stesso in cui la salva**, senza che nessuno si ricordi di aggiungerla
a un elenco. È questa, non le singole correzioni, la risposta alla richiesta
«non deve succedere più su nessuna pista».

⚠️ Il test parte **rosso su cinque piste**, e va scritto prima delle correzioni.

## Cosa resta fuori

- **I buchi d'erba ponte/sopraelevata**: sottosistema del terreno, indagine
  separata, serve uno screenshot dell'utente perché non si riproduce misurando.
- **Rifare il criterio di posizionamento** di alcun modulo: la porta dice sì o
  no, non dove mettere le cose. Se dopo la migrazione una pista risultasse
  spoglia in un punto, è un tema di *quel* modulo e si affronta a parte.
- **Il rename di `prova`** e l'editor (blocchi D/E/F).
