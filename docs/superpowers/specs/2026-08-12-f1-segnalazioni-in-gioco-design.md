# F1 — segnalazioni in gioco (tasto M)

Data: 2026-08-12 · Branch: `f1-ghiaia`

## Il problema

Quando l'utente trova un difetto scenografico durante un playtest, il difetto
arriva a me come frase ("una tribuna è posizionata male"). Localizzarlo costa
un giro di ipotesi e misure a tappeto: nel playtest del 2026-08-12 sono state
misurate tutte e 99 le reti, tutti i moduli di tutte le schiere e quattro
tracciati interi, senza trovare il difetto — perché mancava il *dove*.

## Cosa costruiamo

Un tasto in gioco che, premuto, registra la posizione dell'auto e la direzione
in cui sta guardando. L'utente fa un giro di ricognizione premendo `M` ogni
volta che vede qualcosa che non va, poi in chat commenta i punti in ordine
("il primo è la tribuna storta, il terzo è un albero dentro il muro"). Io leggo
la lista e so già di quale oggetto si parla.

## Non obiettivi

Scartati esplicitamente, per tenere la cosa piccola:

- **Screenshot del frame.** Richiederebbe `preserveDrawingBuffer` sul renderer e
  file pesanti. Scelta dell'utente: bastano le coordinate.
- **Testo digitato in gioco.** Nessuna pausa e nessun campo da compilare: il
  commento arriva in chat, dopo il giro.
- **Rilettura delle segnalazioni dentro il gioco.** La lista la stampo io.
- **Gamepad.** Solo tastiera, per scelta dell'utente.

## Componenti

### 1. Registrazione — `frontend/f1.js`

Accanto al debug hitbox già presente (riga 1979, tasto `h`):

- `M` registra una segnalazione. Ignorato se il focus è in un campo di testo
  (la guardia `isTypingInField` esiste già a riga 1961).
- `Shift+M` annulla l'ultima segnalazione della sessione corrente.
- Conferma a schermo per ~1.5 s: `Segnalazione 3 registrata`. Il numero
  mostrato è **quello assegnato dal server nella risposta**, non un contatore
  locale: così il numero che l'utente vede e quello nel file non divergono mai.
- Se la POST fallisce, il messaggio è `Segnalazione NON salvata` — mai una
  conferma falsa.
- Nessuna emoji nei messaggi (preferenza utente già in vigore nell'UI).

Dati raccolti al momento della pressione:

| campo | origine |
|---|---|
| `pos` x/y/z | `myCarGroup.position` (`f1.js:2107`) |
| `headingDeg` | `myCarGroup.rotation.y`, convenzione del gioco `atan2(tangente.x, tangente.z)` — 0° = verso +Z, cresce verso +X (vedi commento a `trackScenery.js:917`) |
| `camera` | `cameraMode` (`third` / `first`) |
| `guardaDietro` | `isLookingBack()` (`f1.js:767`) |
| `velocita` | la stessa che l'HUD mostra: `Math.abs(speed) * 55` dallo stato interpolato (`f1.js:2402`) |
| `giro` | ultimo valore ricevuto da `f1LapUpdate` (`f1.js:1737`), `null` se ignoto |
| `trackId` | `f1.js:7` |
| `sessione` | id generato una volta al caricamento della pagina |

`sessione` serve a tenere separati giri di ricognizione diversi e a dare a
`Shift+M` un bersaglio non ambiguo.

### 2. Salvataggio — `backend/server.js`

Due route dentro il blocco `NODE_ENV !== 'production'` già esistente
(riga 25), stesso schema di `/dev/minimap`:

- `POST /dev/f1-marker` — valida, assegna il progressivo `n`, appende, risponde
  `{ ok: true, n }`.
- `POST /dev/f1-marker/annulla` — riceve `{ sessione }`, rimuove l'ultimo record
  di quella sessione, risponde `{ ok: true, n }` col numero rimosso (o
  `{ ok: false }` se non c'era niente da rimuovere).

Validazione: `trackId` stringa non vuota (≤ 64 caratteri), `pos.x/y/z` e
`headingDeg` numeri finiti, `sessione` stringa non vuota. Payload non valido →
400 senza scrivere. Tetto di 500 record per file, per non far crescere il file
all'infinito se il tasto resta premuto.

**File:** `backend/tools/f1-segnalazioni.json`, array JSON indentato. Aggiunto a
`.gitignore` (materiale di lavoro, non codice — come `*-telemetry.json`, già
ignorato).

Un record:

```json
{
  "n": 1,
  "sessione": "20260812-141230-a3f",
  "t": "2026-08-12T14:12:41.310Z",
  "trackId": "prova",
  "pos": { "x": 123.4, "y": 2.1, "z": -88.7 },
  "headingDeg": 214.6,
  "camera": "third",
  "guardaDietro": false,
  "velocita": 143.2,
  "giro": 2
}
```

### 3. Lettura — `backend/tools/f1-segnalazioni.js` (nuovo)

`node backend/tools/f1-segnalazioni.js` stampa le segnalazioni in ordine. Per
ognuna:

- **Dove sei sulla pista:** indice del campione di centerline più vicino,
  progressione sul giro in percentuale, distanza dall'asse, dentro/fuori pista.
- **Cosa avevi intorno:** i 5 elementi di scenografia più vicini, con tipo,
  distanza e angolo rispetto al muso (davanti / a destra / dietro…), così si
  distingue subito l'oggetto guardato da quello alle spalle.

Il layout della scenografia viene ricostruito con lo stesso
`TrackScenery.generateLayout` che gira nel gioco (`trackScenery.js:1091`,
modulo UMD già usato dai suoi test in Node), replicando la chiamata del client
a `f1.js:655`.

**Rischio principale, ed è l'unico serio del progetto:** quella chiamata prende
sette argomenti (`trackData`, `trackPts`, `PIT_PTS`, `BARRIER_D`,
`EMBANKMENT_WIDTH`, `seatAnchors`, `BARRIER_PROFILE`) che il client calcola per
conto suo. Se il tool li ricostruisce anche solo leggermente diversi, il layout
diverge e i nomi degli oggetti che stampo non sono quelli che l'utente ha
davanti — un errore silenzioso e peggiore del non avere il tool.

Mitigazioni, nell'ordine:

1. `barrierProfile` e `pitGapPts` si prendono da `trackLoader` lato server, che
   già li espone dal commit `ceb5a2b` — non si ricalcolano a mano.
2. Il tool stampa in testa il conteggio degli elementi per tipo. Si confronta
   una volta col conteggio del client (log temporaneo in `f1.js`): se i numeri
   coincidono su un tracciato, la ricostruzione è quella giusta.
3. Se la verifica al punto 2 fallisce e non si chiude in tempi brevi, il tool
   ripiega sulla sola geometria di pista (punto 1 dell'elenco sopra) e la
   scenografia la misuro a mano sulle coordinate. Il sistema resta utile lo
   stesso: il *dove* è comunque risolto.

## Flusso

1. L'utente entra in gara sul tracciato da controllare.
2. Gira, e a ogni difetto preme `M`; a schermo compare il numero assegnato.
3. Finito il giro, in chat: "il primo è…, il secondo è…".
4. Io leggo il file col tool e passo dritto alla misura dell'oggetto giusto.

## Test

- Unitario sulla funzione che compone il record: dato un `rotation.y` noto,
  `headingDeg` esce nella convenzione dichiarata (0° = +Z), normalizzato in
  `[0, 360)`.
- Unitario sulla validazione della route: payload buono passa, payload con
  `pos.x` non finito o `trackId` vuoto risponde 400 e non scrive.
- Unitario su `annulla`: rimuove solo l'ultimo record della sessione indicata,
  e non tocca quelli delle altre sessioni.
- **Verifica reale, dall'utente:** un giro con tre `M` in punti riconoscibili;
  io rileggo la lista e i tre oggetti nominati devono corrispondere a quello
  che aveva davanti. È questa a dire se il sistema è tarato, non i test.

## Vincoli operativi

- Si lavora nel worktree `.claude/worktrees/f1-ghiaia` (branch `f1-ghiaia`,
  fermo a `125bcff`), non su `main`.
- **Bump di `?v=` su `f1.js` in `f1.html`** (riga 261) alla prima modifica JS,
  altrimenti il browser serve il file vecchio e sembra che `M` non funzioni.
- Server da riavviare dopo le modifiche a `backend/server.js`.
- Un commit per componente, come da preferenza dell'utente. Push manuale suo.

## Dopo

Il primo uso è il difetto ancora aperto del playtest del 2026-08-12: **una
tribuna posizionata male**, mai localizzata.
