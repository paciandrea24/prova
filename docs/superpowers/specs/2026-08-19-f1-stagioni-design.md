# F1 — Stagioni (campionato)

**Data**: 2026-08-19
**Voce di roadmap**: step 7 di `project_f1_roadmap_1_0` (invertito con il 6:
prima le stagioni, poi il tutorial — decisione dell'utente del 2026-08-19).

## Il punto

Oggi una gara è un evento isolato: si sceglie una pista, si corre qualifica e
gara, si torna in lobby e non resta niente. La stagione **incapsula
l'esistente**: dentro il weekend non cambia nulla, cambia solo che i weekend
sono in fila, che i punti si sommano e che fra l'uno e l'altro si può chiudere
il browser e riprendere.

Questo è il vincolo che decide l'architettura: **il codice del weekend non si
tocca**. Se per far funzionare le stagioni servisse mettere le mani dentro
qualifica o gara, la strada scelta è sbagliata.

## Cosa ha chiesto l'utente

Dalla dettatura del 2026-08-18 (roadmap 1.0, voce 7), integrale:

- Giocabile in **singolo** (io + bot) o in **multigiocatore** (io + amici +
  bot). Si corre sempre individualmente, nessuna cooperazione.
- **Account obbligatorio.**
- **Salvataggio** ripristinabile. In multiplayer un salvataggio si riprende
  **solo con esattamente gli stessi giocatori** che l'hanno creato.
- Ogni stagione ha un **nome**; ogni giocatore ha la **lista** delle proprie.
- Dentro ogni weekend il flusso è **esattamente quello di oggi**.
- Fra una gara e l'altra si vede la **classifica di campionato**.
- Chiudere il browser **durante** un weekend fa perdere il weekend: si riparte
  dall'ultimo salvataggio. Il salvataggio è **fra un weekend e l'altro**.
- Alla fine serve un'**animazione di premiazione** del campione.
- Tutto deve restare compatibile con **Render**: niente stato solo su disco.

Due decisioni prese il 2026-08-19, dopo la ricognizione:

1. **Ingresso**: premendo F1 in lobby si apre una schermata di scelta fra
   *Gara veloce* e *Stagione*, e solo dopo si arriva alle impostazioni. È la
   stessa schermata dove poi andrà il tutorial (che l'utente vuole «in lobby,
   premendo F1 la prima volta»): le due cose condividono il posto invece di
   litigarselo.
2. **Calendario fisso, piste non ripetibili.** Ma — parole dell'utente — «non
   voglio che le stagioni siano vincolate al numero totale di piste nel
   gioco»: un giorno le piste saranno tante, o le creeranno gli utenti, e una
   stagione da quaranta gare non ha senso. Quindi **la lunghezza si sceglie**,
   e le piste sono N sorteggiate distinte fra quelle disponibili.

## Cosa c'è già e non va costruito

Verificato il 2026-08-19:

- **Account**: login Firebase in `main` (`backend/auth/verifyFirebaseToken.js`,
  `frontend/login.html`, `frontend/hub-auth.js`). Il prerequisito è
  soddisfatto.
- **Persistenza**: `backend/store/liveryStore.js` è già una collection MongoDB
  con chiave l'uid Firebase, senza cache RAM, compatibile con Render. Le
  stagioni ricalcano quel file quasi riga per riga.
- **Elenco piste**: `GET /api/f1/tracks` (`backend/routes/lobbyRoutes.js:175`).
  Stessa fonte del menù a tendina di oggi.
- **Avvio partita**: host → `startGame {lobbyId, gameId, settings}` → il server
  scrive `lobby.gameSettings` → i client vanno su `/f1.html` e leggono le
  impostazioni da `GET /api/lobby/:id/settings`. La stagione passa di qui
  aggiungendo campi a `settings`, senza un secondo canale.

⚠️ **Da rimuovere**: nella lobby esiste già un menù «Mode: Championship /
Single Race» dentro le impostazioni F1 (`frontend/lobby.html:147`) che **non
legge nessuno** — è un residuo copiato dal vecchio gioco `racing`. Oggi
promette una modalità che non esiste. Sparisce con il passo 1.

## Il modello dei dati

Un documento per stagione, collection `seasons`, database `RacingGameDB`.

```js
{
  _id: '<uuid>',
  nome: 'Mondiale di Andrea',
  creataDa: '<uid>',                 // chi l'ha avviata
  creataIl: '2026-08-19T18:00:00Z',
  aggiornataIl: '...',

  // Chi corre. Fissato alla creazione e MAI più cambiato: è quello che rende
  // confrontabili le classifiche fra un weekend e l'altro.
  piloti: [
    { uid: '<uid>', colore: '#e74c3c', bot: false },
    { uid: null,    colore: '#3498db', bot: true, nome: 'Bot 1' },
  ],

  // Il calendario, sorteggiato alla creazione. Ordine incluso.
  calendario: ['monte-rosso', 'new-monza', 'prova'],
  giro: 0,                           // quale gara si corre adesso (indice)

  // Un blocco per gara CONCLUSA. La classifica generale non si salva: si
  // ricava sommando questi. Un totale salvato accanto ai risultati e' un
  // secondo posto dove la verita' puo' divergere.
  risultati: [
    { pista: 'monte-rosso', ordine: ['<uid o colore>', ...], ritirati: [...] },
  ],

  impostazioni: { botsEnabled: true, gridSize: 6 },  // valgono per tutte le gare
}
```

**La classifica non si salva, si calcola.** È la stessa regola già imparata
altrove nel progetto: due posti dove vive lo stesso numero sono due posti che
prima o poi si contraddicono (vedi `feedback_una_cosa_una_misura`).

**Punteggio**: quello vero della F1 — 25, 18, 15, 12, 10, 8, 6, 4, 2, 1 ai
primi dieci. Niente punto del giro veloce: oggi il giro veloce non è premiato
da nessuna parte, e aggiungerlo qui vorrebbe dire spiegarlo nel tutorial. È
una costante in un punto solo, cambiarla dopo costa una riga.

**I bot fanno punti e stanno in classifica.** Senza, in singolo non ci sarebbe
nessun campionato: ci sarebbe solo il proprio totale che cresce.

**I bot hanno identità stabile per tutta la stagione**: stessa lista, stessi
colori, stesso numero, sorteggiati alla creazione e riusati ad ogni gara.
Oggi i bot nascono ad ogni partita; questo è l'unico punto in cui la stagione
deve dire qualcosa a chi crea la griglia.

## Il calendario

Alla creazione si sceglie **quante gare** fra un minimo di 3 e il numero di
piste disponibili. Poi si sorteggiano quelle N piste, distinte, e si fissa
l'ordine.

Oggi le piste sono 4 (`monte-rosso`, `new-monza`, `prova`, `prova-notturno`),
quindi si può scegliere fra 3 e 4. Domani, con venti piste, si sceglie fra 3 e
20 — **niente è legato al numero 3 né al numero totale**, che era la richiesta.

⚠️ **Nota da portare all'utente**: il sorteggio pesca fra i FILE delle piste, e
`prova` e `prova-notturno` sono lo stesso tracciato di giorno e di notte. Per
il calendario contano come due piste diverse. Se non è quello che vuole,
serve un campo nel file della pista che dica «sono una variante di X» — ma è
una decisione sua, non una da prendere qui.

## Il flusso

```
lobby ──premi F1──> [ GARA VELOCE ]  ──> impostazioni di oggi ──> gara
                    [ STAGIONE    ]
                          │
              ┌───────────┴────────────┐
         nuova stagione            riprendi
         (nome, quante gare)    (lista delle mie)
              └───────────┬────────────┘
                          ▼
                  ┌───────────────┐
                  │  CALENDARIO   │  gara 2 di 4 · prossima: new-monza
                  │  + CLASSIFICA │  [ CORRI ]  [ ESCI ]
                  └───────┬───────┘
                          │ CORRI
                          ▼
              il weekend di oggi, INTATTO
              (mescole → qualifica → gara → podio)
                          │
                          ▼
                  risultato registrato
                  SALVATAGGIO su Mongo
                          │
              ┌───────────┴───────────┐
        restano gare              era l'ultima
              │                         │
              └──> torna al calendario  └──> PREMIAZIONE del campione
```

**Il punto di salvataggio è uno solo**: subito dopo che una gara è finita e il
risultato è stato registrato. Chi chiude il browser a metà weekend rientra e
ritrova il calendario com'era prima di quel weekend — che è esattamente quello
che l'utente ha chiesto, e che si ottiene *non* salvando mai a metà.

**Riprendere in multiplayer** richiede che in lobby ci siano esattamente gli
uid di `piloti` (i non-bot). Né uno in meno né uno in più. Se manca qualcuno la
stagione compare nella lista ma non si può avviare, e la schermata dice chi
manca.

⚠️ **Conseguenza che l'utente deve conoscere**: se un amico non torna mai, quel
salvataggio resta bloccato per sempre. Sostituirlo con un bot sarebbe possibile
ma cambia la regola che ha dettato, quindi **non** è in questa spec.

## I cinque passi

Uno per volta, ciascuno con il suo playtest, come da convenzione del progetto.

1. **Lo smistamento in lobby.** La schermata di scelta dopo F1; *Gara veloce*
   porta esattamente dove porta oggi; *Stagione* porta a un pannello vuoto.
   Via il menù «Mode» morto. — *Playtest: la gara veloce funziona come prima.*
2. **Creare e ritrovare una stagione.** Nome, quante gare, sorteggio del
   calendario, lista bot, salvataggio su Mongo, lista delle proprie stagioni,
   guardia dei "stessi giocatori". Non si corre ancora. — *Playtest: creo,
   ricarico la pagina, la ritrovo.*
3. **Il weekend dentro la stagione.** *CORRI* lancia il weekend con la pista
   del calendario; a fine gara il risultato viene registrato e si torna al
   calendario. — *Playtest: due gare di fila, e una chiusa a metà che non deve
   contare.*
4. **La classifica di campionato** fra una gara e l'altra, con i punti.
5. **Fine stagione**: classifica finale e **premiazione del campione**.
   L'utente non ha idee («non ci sono piloti, solo auto») e ha chiesto
   consiglio: la proposta si fa quando si arriva qui, non ora — a quel punto
   esisteranno già il podio e lo sting riusabile dello step 2 della roadmap, e
   la scelta va fatta sapendo cosa c'è.

## Cosa questa spec NON copre

- Il **tutorial** (step 6): viene dopo, e userà la schermata del passo 1.
- La **premiazione** in dettaglio: decisa al passo 5.
- Il caso «un giocatore non torna più»: fuori portata per scelta, vedi sopra.
- Qualunque modifica **dentro** il weekend. Se ne serve una, la strada è
  sbagliata e si riapre la spec.
