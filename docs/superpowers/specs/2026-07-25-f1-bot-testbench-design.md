# F1 — Banco prova bot (testbench) Design

## Contesto e obiettivo

Durante questa sessione sono stati diagnosticati e corretti diversi bug di comportamento dei bot (sorpassi, scia, reazione al via, ingresso ai box) usando script di simulazione headless scritti al volo, che riusano le funzioni fisiche/IA reali (`physics.*`, `updateBotInputs`) ma con un ciclo di gioco semplificato a mano (niente `checkLap`, usura gomme reale, autopilota box, ecc.). Questo ha creato un rischio reale: una correzione verificata nello script può non coincidere con quello che si osserva in una gara vera, perché lo script non riproduce l'intero ciclo (`tickGame`).

Obiettivo di questo progetto: uno strumento di sviluppo che fa correre 6 bot fra loro usando **la stessa identica `tickGame`** del gioco vero (non una riproduzione approssimata), con una visuale 3D per osservarli dall'esterno e controlli per pilotare lo scenario (pista, numero bot, usura/mescola di partenza, pausa/velocità/passo singolo) — per verificare visivamente le correzioni invece di fidarsi solo di una simulazione testuale.

Fuori scope per questa versione: posizionamento di partenza forzato (bot già vicini/appaiati), telecamera libera stile editor 3D, sessioni multi-utente concorrenti, qualifica (si parte sempre direttamente in gara).

## Architettura

Segue lo stesso pattern dei moduli gioco esistenti in `backend/sockets/games/` (uno per gioco, funzione `(io, socket) => {...}` registrata in `socketManager.js`) e lo stesso spirito di `minimap-gen.html`, già presente nel progetto come pagina di sviluppo separata dal gioco vero.

Componenti:
- **`backend/sockets/games/f1Testbench.js`** (nuovo): crea una sessione con solo bot (nessun giocatore reale) e ne guida il ciclo fisico chiamando `tickGame` — la stessa funzione del gioco vero — su un timer controllabile (pausa/velocità/passo).
- **`frontend/f1-testbench.html` + `frontend/f1-testbench.js`** (nuovi): scena 3D che riusa i moduli condivisi (`TrackMeshBuilder`, `TrackScenery`, `trackGeometry.js`), con telecamera a ciclo tra le auto e un pannello di controllo scenario/riproduzione.

Modifiche a codice di produzione, entrambe additive/di estrazione, nessun cambio di comportamento: **`backend/sockets/games/f1GameSocket.js` esporta anche `tickGame`** (oggi solo `physics.*` è esportato), stesso principio già in uso per `backend/tools/f1LapSimulator.js`; e **`frontend/f1.js` delega il caricamento/ricolorazione auto al nuovo modulo condiviso `frontend/shared/carLoader.js`** invece di definirlo localmente (vedi sezione Frontend) — così un cambiamento futuro al modello/ricolorazione delle auto nel gioco vero si riflette automaticamente nel banco prova.

`socketManager.js`: una riga in più per registrare `f1Testbench(io, socket)` accanto agli altri moduli gioco.

## Backend — `f1Testbench.js`

Una sola sessione attiva alla volta (strumento per lo sviluppatore, non multi-utente): stato tenuto in una variabile di modulo separata, mai in `activeGames` (nessuna possibilità di confusione con le lobby vere).

Eventi socket esposti:

- **`f1tbStart`** `{trackId, botCount, tyreWear, compound}`
  1. Valida l'input lato server (vedi Gestione errori).
  2. Se una sessione precedente è attiva, la ferma (`clearInterval`) prima di crearne una nuova.
  3. Carica la pista (`loadTrack`), crea un `game` con `phase: 'race'`.
  4. Crea `botCount` bot con `createBots` (nessuno slot umano: tutti bot).
  5. Chiama `assignGridSpawns` per posizionarli in griglia.
  6. Sovrascrive `tyreWear`/`compound` su ogni bot **dopo** `assignGridSpawns` (che altrimenti li resetterebbe a gomme fresche/mescola di default).
  7. Avvia `setInterval(() => tickGame(io, testLobbyId, game), PHYSICS_TICK_MS)`, salvando l'handle per pausa/stop.
- **`f1tbPause`**: `clearInterval` del timer corrente.
- **`f1tbResume`**: nuovo `setInterval`, stessa cadenza.
- **`f1tbStep`**: valido solo se in pausa; chiama `tickGame` una sola volta. Se non in pausa, ignorato silenziosamente.
- **`f1tbSetSpeed`** `{multiplier}` (1/2/4): non accorcia l'intervallo del timer (rischierebbe di accumulare ritardo se il tick costa più del previsto); invece esegue `tickGame` **N volte di fila** ad ogni scatto del timer normale — stessa cadenza reale, più passi fisici per callback, comportamento deterministico.
- **`f1tbStop`**: ferma il timer e libera la sessione.
- **Disconnessione del socket**: se il socket che ha avviato la sessione si disconnette, il timer viene fermato (nessun processo fantasma lato server).

## Frontend — `f1-testbench.html` / `.js`

Pagina indipendente da `f1.html`/`f1.js`, non li modifica.

Riusato senza modifiche: `TrackMeshBuilder`, `TrackScenery`, `trackGeometry.js` (moduli condivisi in `frontend/shared/`).

Estratto in un modulo condiviso (non duplicato — decisione rivista rispetto alla bozza iniziale): la logica di caricamento/ricolorazione GLB delle auto, oggi funzioni locali dentro `f1.js`, viene estratta in `frontend/shared/carLoader.js`, usato sia da `f1.js` sia da `f1-testbench.js`. Se in futuro si modifica il caricamento/ricolorazione delle auto nel gioco vero, il banco prova lo riceve automaticamente, senza rischio di divergenza silenziosa tra i due. Questo è l'unico punto in cui il piano tocca `f1.js` (un refactor di estrazione, nessuna modifica di comportamento).

Nuovo:
- **Telecamera a ciclo**: stessa telecamera in terza persona già esistente in `f1.js`, agganciata a un "colore attualmente seguito" invece che a `myColor` fisso; un tasto (`N`, non `TAB` — `TAB` sposta il focus tra gli elementi HTML del pannello di controllo, non affidabile come hotkey) passa all'auto successiva (ciclo, torna alla prima dopo l'ultima).
- **Pannello di controllo** (overlay HTML): select pista (elenco da `listTracks`), select numero bot (2-6), controllo usura gomme e mescola di partenza, pulsanti Avvia / Pausa-Riprendi / Passo / velocità 1x-2x-4x, Stop.
- **Ricezione stato**: si collega ai nuovi eventi `f1tb*` (non `joinLobby`/`joinF1Game`); ogni auto ricevuta è resa con lo stesso codice già usato da `f1.js` per le auto degli avversari (nessuna "auto propria" in questo strumento).

## Gestione errori

- Pista/mescola/numero bot non validi: validati **lato server** prima di creare la sessione (mai fidarsi del client — stesso principio già in uso per i dati pista caricati dall'editor). Un evento `f1tbError` con messaggio leggibile torna al client; la sessione precedente (se c'era) resta intatta.
- Avvio di una nuova sessione mentre una è già attiva: la precedente viene fermata in modo pulito prima di crearne una nuova (nessun timer duplicato).
- Disconnessione durante una sessione attiva: timer fermato.
- `f1tbStep` mentre non in pausa: no-op, non un errore.

## Testing e verifica

- Nessun nuovo test per fisica/IA: è la stessa `tickGame` già coperta da `f1GameSocket.physics.test.js` e `f1Bot.test.js` — zero duplicazione.
- Nuovi test automatici solo per la validazione dello scenario in `f1Testbench.js` (numero bot fuori range 2-6, mescola sconosciuta, `trackId` inesistente → errore pulito via `f1tbError`, non un crash del processo).
- Il resto (telecamera, pannello, resa visiva, sensazione generale) si verifica manualmente in localhost, come tutto il lavoro 3D di questo progetto — non è automatizzabile in modo sensato.
