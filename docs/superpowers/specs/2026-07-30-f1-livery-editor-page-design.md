# F1 — 4b/D: schermata di personalizzazione/salvataggio livrea

## Contesto

Sotto-progetto **D** di [[project_f1_livery_ingame_port]] (4b). A (persistenza
Mongo, [[project_f1_livery_ingame_port]]) e B' (colori pre-calcolati applicati
in gara, commit `865e6ab`) sono chiusi e verificati end-to-end con un account
reale. Oggi il gioco carica `liveryColors` da una fixture statica
(`frontend/assets/custom/f1CarTestLivery.json`), uguale per tutte le auto. D
sostituisce la fixture con una vera schermata dove il giocatore sceglie
pattern/colori (manualmente o via AI), vede un'anteprima 3D dal vivo identica
a quella dell'editor esterno, e salva.

**Riferimento**: tool esterno `C:\Users\pacia\Desktop\livery\voxel_livery_studio.html`
(NON nel repo, NON git) — 18 pattern completi, sistema sponsor, generazione AI
via Gemini. Questo sotto-progetto ne porta un **sottoinsieme deliberatamente
ridotto**, per priorità esplicita dell'utente: i 3 pattern già validati nello
spike di B' più la generazione AI, piuttosto che tutti e 18 i pattern senza
AI.

## Garanzia di coerenza (stesso principio di A)

L'algoritmo che calcola pattern+ombreggiatura è **lo stesso, invariato**, di
`frontend/shared/liveryPattern.js` (già validato con dati reali in B') — D lo
richiama di nuovo (non più solo come riferimento storico), non lo riscrive.
Il colore salvato è esattamente l'array che l'anteprima 3D sta già
mostrando al momento del salvataggio — nessuna riconversione tra anteprima e
salvataggio.

## Scope

**Dentro:**
- 4 pattern: `racing_stripes`, `split_sides`, `checkers` (già in
  `liveryPattern.js`) + `solid` (gratuito: comportamento di default già
  presente quando nessun `case` combacia, nessun codice nuovo).
- Anteprima 3D dal vivo (Three.js r128, stesso stack del resto del progetto),
  stile visivo equivalente all'editor esterno (camera orbitabile, auto ferma
  al centro).
- Generazione AI di un tema (nome + 3 colori + pattern) da una descrizione
  testuale, tramite Gemini **proxato dal backend** (mai una chiave esposta
  lato client) — con fallback locale deterministico se Gemini non risponde o
  restituisce un pattern non supportato.
- Salvataggio (riusa `POST /api/livery`, già pronto da A) e ricaricamento
  della livrea esistente all'apertura pagina (riusa `GET /api/livery/:uid`).
- Nuovo pulsante nella lobby (`frontend/lobby.html`, game-card "Racing",
  stessa posizione/stile di `leaderboard-mini-btn`) che apre `livery.html`.

**Fuori scope (esplicitamente rimandato):**
- Gli altri 14 pattern dell'editor esterno (gradient, halves, diagonal,
  abstract, top_deck, tricolor, camo, waves, pinstripe, flames, tiger,
  digital_rain, patchwork, speed_lines) — richiedono porting non banale
  ciascuno, priorità inferiore ad avere l'AI funzionante ora.
- Sistema sponsor (loghi finti a griglia) — l'utente ha confermato di non
  volerlo, non gli piaceva nemmeno nell'editor esterno.
- **C** (rete multiplayer: come i client vedono la livrea degli avversari in
  gara) — sotto-progetto separato, non toccato qui.
- Ri-editing avanzato (undo, storico livree, più slot salvati per utente) —
  un solo slot per uid, come già progettato in A.

## Architettura

**Nuovi file frontend:**
- `frontend/livery.html` — canvas Three.js + pannello controlli (4 pulsanti
  pattern, 3 color picker primario/secondario/accento, campo testo + pulsante
  "Genera", pulsante "Save").
- `frontend/livery.js` — logica pagina: gate login, caricamento modello,
  wiring controlli, chiamate API.
- `frontend/styles/livery.css`.

**Riusati senza modifiche:**
- `frontend/shared/liveryPattern.js` — l'algoritmo (`applyVoxelLiveryPattern`)
  torna a essere richiamato da codice attivo (aggiornare solo il commento di
  intestazione, che oggi dice "non più richiamato dal gioco").
- `backend/store/liveryStore.js`, `backend/auth/verifyFirebaseToken.js` —
  invariati.

**Nuovi file backend:**
- `backend/services/themeGenerator.js` — porting di `generateTheme`/
  `localTheme`/`LOCAL_THEMES` dall'editor esterno: chiama Gemini con la
  chiave da `process.env.GEMINI_API_KEY` (mai nel client), vincola
  `patternStyle` ai soli 4 pattern supportati (schema di richiesta con enum
  ristretto invece dei 18 originali; se Gemini risponde comunque con un
  pattern fuori da questi 4, o la chiamata fallisce/non risponde in formato
  valido, fallback al tema locale deterministico — anch'esso filtrato agli
  stessi 4 pattern, stessa logica hash-del-prompt dell'editor per i temi non
  in `LOCAL_THEMES`).

**File modificati:**
- `backend/routes/livery.js` — nuova rotta `POST /api/livery/generate-theme`,
  protetta da `verifyFirebaseToken` (stesso middleware di `POST /api/livery`
  — la chiamata Gemini ha un costo reale, non va lasciata pubblica).
- `frontend/lobby.html`/`lobby.js` — nuovo pulsante icona sul game-card
  "Racing", che naviga a `livery.html`.
- `backend/.env` — nuova riga `GEMINI_API_KEY` (stessa chiave già in uso
  nell'editor esterno, spostata qui invece che restare lato client).

**Perché un loader modello dedicato invece di riusare
`carLoader.js::loadCarModel`**: quella funzione porta con sé audio motore
posizionale (richiede un `AudioListener`/buffer non pertinenti qui), rotazione
ruote, colore mescola gomme — tutta roba di gara non utile per una pagina di
sola personalizzazione. `livery.js` carica `f1Car.glb` con un loader leggero
dedicato: centra il modello, salva `pristineTex` per ogni mesh con texture
(necessario perché `liveryPattern.js` ne dipende), nessuna ruota che gira,
nessun suono, auto ferma in scena con `OrbitControls` (nuova dipendenza CDN,
r128, mai usata finora nel progetto) per guardarla da tutti gli angoli.

## Data flow

1. Al caricamento pagina: se non autenticato (Firebase), redirect a
   `login.html` — l'intera pagina richiede un account.
2. `GET /api/livery/:uid` (uid dal token) per pre-caricare pattern/colori
   già salvati; 404 (prima volta) → default (`racing_stripes`, rosso/bianco/
   nero).
3. Caricamento modello (loader dedicato) + `OrbitControls`.
4. **Modifica manuale** (pattern o color picker): richiama subito
   `LiveryPattern.applyVoxelLiveryPattern(carGroup, {pattern, primary,
   secondary, accent})` → anteprima aggiornata dal vivo.
5. **"Genera"**: il testo del campo va a `POST /api/livery/generate-theme`
   (con token) → risposta `{themeName, primaryPaint, secondaryPaint,
   accentPaint, patternStyle}` → il client aggiorna pattern/color-picker con
   questi valori e ricalcola l'anteprima con la STESSA funzione del punto 4
   (nessuna duplicazione di logica).
6. **"Save"**: legge `mesh.geometry.attributes.color.array` per Chassis/
   Nose/Plank dall'ultima anteprima calcolata, costruisce `{liveryColors,
   liveryParams: {pattern, primary, secondary, accent, themeName}}`, prende
   un ID token fresco (`getIdToken()`) e chiama `POST /api/livery` (invariato
   da A).

## Error handling

- Non autenticato → redirect a `login.html`, editor mai visibile.
- `GET /api/livery/:uid` fallisce/404 al caricamento → default silenziosi,
  non un errore mostrato.
- "Genera" senza testo → messaggio d'errore inline, nessuna chiamata di rete.
- `generate-theme` lato backend: Gemini irraggiungibile, risposta malformata,
  o `patternStyle` fuori dai 4 supportati → fallback silenzioso al tema
  locale deterministico (stesso comportamento dell'editor esterno).
- `generate-theme` senza token/token scaduto → `401`, stesso formato
  `{"error": "..."}` delle altre rotte livery.
- "Save" fallisce (token scaduto, 500, rete) → toast d'errore, l'anteprima
  corrente resta intatta, si può ritentare senza perdere le scelte fatte.

## Testing

- `frontend/livery.js`/`liveryPattern.js`: nessun framework di test browser
  nel progetto per contenuti Three.js/DOM — verifica manuale in localhost,
  stesso limite già accettato per B' e per l'editor esterno.
- `backend/services/themeGenerator.js`: logica pura Node, testabile con
  `node:test` — in particolare il fallback locale (`localTheme`) dato un
  prompt fisso deve essere deterministico e restituire sempre uno dei 4
  pattern supportati (mai uno dei 18 originali). La chiamata reale a Gemini
  non è automatizzabile (dipende da un servizio esterno vero, stesso
  principio già adottato per Firebase/Mongo) — verifica manuale con un
  prompt reale in localhost.
- Verifica di chiusura: un tema generato via AI (o fallback locale) e poi
  salvato deve ricomparire identico ricaricando `livery.html` (round-trip
  con `GET /api/livery/:uid`), e deve apparire in gara tramite
  `carLoader.js` esattamente come già verificato per B'.
