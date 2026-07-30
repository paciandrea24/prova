# F1 — 4b/A: persistenza livrea su MongoDB (verifica identità via Firebase)

## Contesto

Sotto-progetto **A** di [[project_f1_livery_ingame_port]] (4b). B' (colori
pre-calcolati applicati in gara, commit `865e6ab`) è chiuso e verificato:
oggi il gioco carica `liveryColors` da una fixture statica
(`frontend/assets/custom/f1CarTestLivery.json`) uguale per tutte le auto.
Questo sotto-progetto sostituisce la fixture con un vero salvataggio per
utente su MongoDB, verificato tramite il sistema di login Firebase già
chiuso in 4a.

D (schermata di personalizzazione/salvataggio in gioco) **non esiste
ancora** — si testa questo sotto-progetto via `curl`/script, senza UI.

**Garanzia centrale di questo design**: il dato salvato in Mongo
(`liveryColors`) è byte-per-byte lo stesso array già prodotto e validato
dall'algoritmo dell'editor (`voxel_livery_studio.html`/
`liveryPattern.js`, spike di B') — nessuna riconversione, nessun
ricalcolo nel percorso salva→leggi→applica. Il meccanismo che lo applica
in game (`carLoader.js::loadCarModel`, 4° parametro `liveryColors`) è
esattamente quello già verificato pixel-identico in B' (unica differenza
nota e accettata: tone mapping/illuminazione diversi tra editor e pista,
non un problema del dato). Questo sotto-progetto A garantisce solo che
*qualunque* array arrivi da monte (oggi la fixture, in futuro D) venga
salvato e restituito intatto — non tocca né il calcolo né l'applicazione.

## Scope

Solo backend: endpoint per salvare/leggere la livrea di un utente,
verifica del token Firebase lato server. **Non tocca**: `carLoader.js`
(già pronto da B'), l'editor esterno, la UI di gioco (D), la
comunicazione tra giocatori in gara (C).

## Architettura

- **`backend/store/liveryStore.js`** (nuovo modulo, stesso pattern di
  `leaderboard.js`: client `mongodb` diretto, nessun ORM): collection
  `liveries` dentro il database `RacingGameDB` già esistente, un
  documento per `uid` Firebase (`_id: uid`). Nessuna cache RAM — a
  differenza della leaderboard (letta ad ogni partita), le livree sono
  per-utente e lette raramente; query diretta a Mongo per richiesta. Se
  in futuro diventa un collo di bottiglia si aggiungerà caching, non
  prima (YAGNI).

- **`backend/auth/verifyFirebaseToken.js`** (nuovo modulo): usa
  `firebase-admin` (nuova dipendenza in `backend/package.json`).
  Inizializza `admin.initializeApp({ credential: admin.credential.cert(...) })`
  una volta all'avvio, leggendo il service account JSON dalla env var
  `FIREBASE_SERVICE_ACCOUNT_JSON` (stringa JSON, stessa convenzione di
  `MONGODB_URI` — nessun file da gestire/committare, funziona su Render
  senza passi extra di deploy). Se la env var manca: warning in log
  (stesso stile del warning `MONGODB_URI` mancante in `leaderboard.js`),
  nessun crash — il middleware risponderà sempre 503.

  Espone un middleware Express: legge `Authorization: Bearer <idToken>`,
  verifica con `admin.auth().verifyIdToken(idToken)`, attacca `req.uid`;
  401 se l'header manca o il token non è valido.

- **Due nuove rotte HTTP** (router dedicato `backend/routes/livery.js`,
  montato in `server.js`):
  - `POST /api/livery` — **protetta** dal middleware. Body:
    `{ liveryColors, liveryParams }`. Upsert del documento con
    `_id: req.uid` (chi salva può salvare solo la PROPRIA livrea — lo
    `uid` non è mai letto dal body, solo dal token verificato).
  - `GET /api/livery/:uid` — **pubblica**, nessun token. La livrea è
    puramente estetica, visibile comunque a chiunque guardi l'auto in
    pista — richiedere autenticazione anche in lettura complicherebbe
    inutilmente C (un client dovrebbe autenticarsi per vedere la livrea
    di un ALTRO giocatore). Ritorna 404 se l'uid non ha mai salvato una
    livrea.

## Schema dati

Documento in collection `liveries`:

```json
{
  "_id": "firebase-uid-abc123",
  "liveryColors": {
    "Chassis": [0.8, 0.1, 0.1, 0.8, 0.1, 0.1, "... una tripletta RGB per vertice"],
    "Nose":    [0.9, 0.9, 0.9, "..."],
    "Plank":   [0.05, 0.05, 0.05, "..."]
  },
  "liveryParams": {
    "pattern": "racing_stripes",
    "baseColor": "#CC1A1A",
    "secondaryColor": "#FFFFFF",
    "accentColor": "#111111"
  },
  "updatedAt": "2026-07-29T20:00:00.000Z"
}
```

- `liveryColors`: stesso formato già consumato da
  `carLoader.js::loadCarModel(playerColor, onReady, deps, liveryColors)`
  (4° parametro, B') — nessuna trasformazione tra salvataggio e
  consumo in game.
- `liveryParams`: non ancora usato da nessun consumer (nessun editor
  "vero" lo produce ancora) — salvato/restituito passivamente da subito
  per permettere in futuro (D) di riaprire l'editor e modificare una
  livrea già salvata invece di doverla ricreare da zero (i colori-per-
  vertice fusi non sono invertibili con precisione nei parametri
  originali).

## Data flow

1. Client autenticato (sessione Firebase da 4a) ottiene un ID token
   fresco via `firebaseUser.getIdToken()`.
2. `POST /api/livery` con `Authorization: Bearer <idToken>` e body
   `{ liveryColors, liveryParams }` → middleware verifica il token,
   estrae `uid` → `liveryStore.saveLivery(uid, { liveryColors, liveryParams })`
   (upsert, aggiorna anche `updatedAt`).
3. In gara (oggi ancora manuale/fixture, domani C): `GET /api/livery/:uid`
   → `liveryStore.getLivery(uid)` → il client passa `liveryColors` a
   `loadCarModel()` esattamente come fa oggi con la fixture statica.

## Error handling

- `POST` senza token o token non valido → 401, `{ error: "..." }`,
  nessuna scrittura.
- `POST` con token valido ma body senza `liveryColors` → 400, nessuna
  scrittura.
- `GET` per uid mai salvato → 404.
- Mongo irraggiungibile → 500 su entrambe le rotte, log esplicito
  (stesso stile di `leaderboard.js`).
- `FIREBASE_SERVICE_ACCOUNT_JSON` mancante → `POST` sempre 503 (nessun
  crash del server), `GET` resta comunque disponibile per dati già
  presenti in Mongo.

## Testing

Nessun test automatico `node:test` per questa parte (dipende da servizi
esterni veri, Firebase + Mongo, non isolabile senza mock pesanti che
avrebbero un valore diagnostico basso — stessa scelta già fatta per le
integrazioni esterne nel progetto). Verifica manuale end-to-end:

1. Generare un ID token di test per un utente reale creato in 4a, via
   Firebase Auth REST API (`POST
   https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword`
   con l'API key web del progetto Firebase).
2. `curl -X POST http://localhost:3000/api/livery -H "Authorization: Bearer <idToken>" -d @f1CarTestLivery.json`
   (la fixture già esistente di B' come corpo di test) → verificare
   risposta 200/201.
3. `curl http://localhost:3000/api/livery/<uid>` → confrontare
   byte-per-byte l'output con `f1CarTestLivery.json` in input.
4. Ripetere il POST senza header `Authorization` → verificare 401.
5. `curl` con uid inesistente → verificare 404.

## Fuori scope (prossimi sotto-progetti)

- **D**: schermata di personalizzazione/salvataggio in gioco — è lì che
  `liveryParams`/`liveryColors` VERI (non la fixture) verranno prodotti
  e mandati a `POST /api/livery`.
- **C**: come il gioco sa QUALE uid ha quale livrea per le auto
  avversarie in gara (probabile: il socket comunica solo "il giocatore X
  ha uid Y", ogni client fa il proprio `GET /api/livery/:uid`).
- Reset/cancellazione livrea, versioning/storico livree, quota per
  utente — non richiesti ora.
