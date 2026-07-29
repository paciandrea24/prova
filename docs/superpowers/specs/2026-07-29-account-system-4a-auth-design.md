# Sistema Account — 4a: Login/Registrazione (Firebase Authentication)

## Contesto

Prima messa in piedi di un vero sistema di account per la piattaforma
(finora nessun account, solo nickname liberi in lobby). Nasce dal bisogno
di persistere la livrea F1 custom tra una partita e l'altra (punto 4 della
discussione [[project_f1_voxel_livery_studio]]), ma il sistema di login va
progettato generico/riusabile da subito, non F1-specifico.

**Vincolo di prodotto non negoziabile**: la piattaforma non ha e non deve
avere nickname visibili — i giocatori sono identificati solo dal colore
scelto in lobby (vedi `backend/store/leaderboard.js`, che già usa iniziali
stile arcade a 3 lettere + colore, non un nome persistente). L'account
è un contenitore **privato** per credenziali/preferenze: non deve MAI
esporre email, username o nome Google in lobby, HUD, leaderboard o
altrove nel gioco.

**Infrastruttura esistente rilevante**:
- Backend Node/Express + Socket.io, stato in memoria (Map) per
  lobby/partite. MongoDB già collegato (`backend/store/leaderboard.js`,
  driver `mongodb` già in `package.json`) per la leaderboard, letta in
  cache RAM all'avvio e scritta in background.
- Frontend vanilla JS, nessun bundler, librerie esterne caricate da CDN
  (pattern già usato per Three.js).
- Piattaforma già hostata su **Render**. L'hub (`index.html`/`lobby.*`) è
  in **inglese**; i singoli giochi (F1, FPS, ecc.) restano in italiano —
  questo sotto-progetto tocca solo l'hub, quindi tutte le stringhe UI
  che introduce sono in inglese.

## Scope di questo sotto-progetto (4a)

Solo login/registrazione/logout. **Nessun cambio al backend**, nessuna
scrittura su MongoDB, nessun collegamento tra identità utente e dati di
gioco (livrea, leaderboard) — quello è 4b, un brainstorming separato da
fare dopo, quando questo sotto-progetto sarà chiuso e verificato.

Decisione architetturale: **Firebase Authentication** per identità/login
(gestisce hashing password, sessione, reset password, protezioni
anti-bruteforce — codice di sicurezza maturo e mantenuto, non scritto a
mano), **MongoDB resta il database dei dati di gioco** (leaderboard oggi,
livrea domani in 4b) — separazione netta identità-vs-dati-di-gioco, non
sostituzione di MongoDB.

## Architettura

Login/registrazione avvengono **interamente lato client** con Firebase
JS SDK (da CDN, stesso pattern di Three.js — nessun bundler). Il backend
Express non viene toccato in 4a: la sessione è gestita e persistita
automaticamente dall'SDK Firebase nel browser (sopravvive a refresh e
riavvio, nessun cookie/sessione da programmare a mano). Il backend
entrerà in gioco solo in 4b con `firebase-admin` per verificare il token
lato server quando servirà proteggere/personalizzare dati (es. salvare la
livrea) — non prima.

## Componenti

**Nuovo progetto Firebase** (creato manualmente dall'utente sulla
console Firebase — passo fuori dal codice):
- Authentication → provider **Email/Password** e **Google** abilitati.
- **Authorized domains**: deve includere sia `localhost` (default) sia il
  dominio Render effettivo dell'app (es. `<nome-app>.onrender.com`) —
  senza questo passo il login funziona in locale ma fallisce silenziosamente
  in produzione. Passo manuale esplicito da fare in console Firebase prima
  del deploy.
- La config web Firebase (`apiKey`, `authDomain`, `projectId`, ecc.) è
  progettata per stare nel codice client-side (non è un segreto — Firebase
  la protegge via Authorized domains + regole, non via segretezza della
  chiave) — nessuna variabile d'ambiente Render necessaria per 4a.

**`frontend/login.html` + `frontend/login.js`** (nuova coppia di file,
stesso pattern degli altri giochi/pagine):
- Form email + password, pulsante "Log in".
- Pulsante separato **"Log in with Google"** (popup OAuth gestito da
  Firebase — `signInWithPopup` con `GoogleAuthProvider`). Un login Google
  la prima volta crea automaticamente l'account (Firebase unifica
  login/signup per provider OAuth) — per questo **la pagina di
  registrazione non ha bisogno di un proprio pulsante Google**, quello
  esiste solo nella pagina di login.
- Sotto al form, sezione piccola: *"Don't have an account? **Sign up**"*
  → link a `register.html`.
- Errori Firebase (`auth/wrong-password`, `auth/user-not-found`,
  `auth/email-already-in-use`, `auth/weak-password`, ecc.) mappati a
  messaggi inglesi leggibili, mostrati inline nel form (mai un alert
  generico "errore").
- **Non usare/mostrare mai** `user.displayName` o `user.photoURL`
  restituiti da Google — solo `user.uid` (e `user.email`, privato, mai
  mostrato in UI) contano per l'identità.

**`frontend/register.html` + `frontend/register.js`** (nuova coppia):
- Form email + password + conferma password, pulsante "Sign up"
  (`createUserWithEmailAndPassword`).
- Nessun pulsante Google qui (vedi sopra — motivo esplicito, non
  dimenticanza).
- Stessi criteri di mappatura errori del login.

**`index.html` (hub attuale)**:
- Aggiunto **un solo pulsante "Login"** (inglese, coerente col resto
  dell'hub) accanto/vicino all'ingresso esistente in lobby — porta a
  `login.html`.
- **L'ingresso in lobby resta identico a oggi, invariato** — nessun
  pulsante "continua come ospite": chi non interagisce col pulsante
  "Login" sta già giocando da ospite semplicemente entrando in lobby come
  fa oggi. Nessuna rottura del flusso esistente.
- Stato "loggato": nessun nome/email/foto mostrato **da nessuna parte**
  (hub, lobby, HUD di gioco, leaderboard) — coerente col vincolo di
  prodotto. In 4a basta un indicatore generico non identificativo (es.
  il pulsante "Login" diventa "Log out" quando `onAuthStateChanged`
  rileva un utente loggato) — non serve altro finché non esiste un dato
  reale da mostrare (la livrea, in 4b).

## Data flow

1. Utente entra sull'hub → può ignorare tutto e andare in lobby (guest,
   comportamento di oggi, invariato) oppure cliccare "Login".
2. Su `login.html`: inserisce email+password o clicca "Log in with
   Google" → Firebase SDK autentica, l'SDK mantiene la sessione nel
   browser automaticamente.
3. Da "Log in", link a `register.html` se non ha un account → crea
   account via email+password → Firebase lo autentica subito dopo la
   creazione (comportamento di default dell'SDK).
4. In entrambi i casi, redirect all'hub (`index.html`) dopo successo.
5. `onAuthStateChanged` sull'hub aggiorna l'indicatore Login/Logout ad
   ogni caricamento pagina, in base allo stato reale della sessione
   Firebase (nessuna logica di sessione custom da scrivere).
6. Logout: pulsante "Log out" → `signOut()` → torna allo stato guest,
   nessun redirect necessario (l'hub resta la stessa pagina).

## Fuori scope (rimandato a 4b, non dimenticare)

- Qualsiasi collegamento tra l'utente Firebase (UID) e dati di gioco:
  livrea F1 salvata, leaderboard legata all'account invece che al colore
  grezzo, preferenze di altri minigiochi.
- `firebase-admin` lato backend e verifica token server-side — non
  serve finché non esiste un dato protetto da salvare/leggere.
- Schema MongoDB per account/preferenze (collection nuova, relazione con
  `RacingGameDB` esistente) — da progettare in 4b insieme al formato
  della livrea salvata (già deciso: solo parametri, non `.glb`).
- Reset password, verifica email, cancellazione account — Firebase li
  supporta nativamente ma non sono richiesti per questo primo sotto-
  progetto; da valutare se/quando servono.

## Test/verifica

- Creare il progetto Firebase (Authentication → Email/Password + Google
  abilitati), aggiungere `localhost` e il dominio Render effettivo agli
  Authorized domains.
- In locale: registrazione con email+password nuova → conferma redirect
  all'hub e pulsante che diventa "Log out"; logout → torna a "Login";
  login con le stesse credenziali → funziona; login con password sbagliata
  → messaggio d'errore inline in inglese, non un crash/alert generico.
- Login con Google (account Google reale) → conferma che va a buon fine
  e che **da nessuna parte** (hub, lobby, console browser inclusa se
  visibile in UI) compaiono nome o foto dell'account Google.
- Verificare che entrare in lobby SENZA fare login funzioni esattamente
  come oggi (nessuna regressione per i giocatori guest).
- Ripetere la stessa verifica (registrazione/login/Google/logout) sul
  deploy Render reale, non solo in locale — è il passo che valida
  l'Authorized domain aggiunto in console.
