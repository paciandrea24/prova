# Account system — 4c: login raggiungibile da invito/lobby (returnTo)

## Contesto

Sotto-progetto successivo a [[project_account_system]] (4a, login/registrazione
sull'hub) e a [[project_f1_livery_ingame_port]] (4b, livrea F1 in gioco — già
chiuso: un giocatore loggato vede la propria livrea salvata in gara, e ora
anche quella vera di ogni avversario, vedi sync multiplayer di questa
sessione).

Bug reale trovato investigando "chi viene invitato entra come guest senza
alcun modo di fare login": il link d'invito porta a
`index.html?join=<lobbyId>`, che *ha* il pulsante Login in header — ma una
volta scelto il colore e joinato, l'utente finisce su `lobby.html`, che
**non include affatto Firebase/hub-auth**. Una volta in lobby, loggarsi non è
più possibile in alcun modo, nemmeno volendo.

## Scope

Rendere il login raggiungibile da qualunque punto del flusso pre-gara
(hub e lobby), e far tornare l'utente esattamente dove si trovava dopo il
login/registrazione — senza introdurre alcun gate obbligatorio né un
pulsante "continua come ospite" (il comportamento passivo attuale, guest di
default se non si interagisce col pulsante Login, resta invariato: principio
già stabilito in 4a, confermato per questo sotto-progetto).

**Fuori scope**: qualunque modifica al meccanismo d'invito stesso
(`/index.html?join=<lobbyId>`, invariato), a `f1.html`/`livery.html` (già
gestiscono Firebase per conto loro, non serve un pulsante Login lì — brutta
UX aggiungerne uno a gara in corso), e al caricamento della livrea in gara
(già implementato e verificato: `f1.js` legge lo stato Firebase all'avvio e
carica `GET /api/livery/:uid` se loggato — questo sotto-progetto garantisce
solo che l'utente *arrivi* a fare login in tempo, prima che la gara parta).

## Comportamento atteso

1. **Sessione Firebase già attiva** (login persistente, anche di giorni
   prima): nessun cambiamento — l'utente entra riconosciuto, nessun attrito
   aggiuntivo rispetto a oggi.
2. **Nessuna sessione, nessuna azione**: resta ospite, flusso identico a
   oggi (nessuna rottura, nessun gate).
3. **Clicca "Login"** — da `index.html` o da dentro `lobby.html`, in
   qualunque momento prima che la gara parta — fa login o registrazione, e
   torna **esattamente alla pagina/URL di partenza**: stessa lobby, stesso
   colore già scelto se era in lobby.

## Meccanismo: `returnTo`

- Ogni link/redirect verso `login.html` o `register.html` include
  `?returnTo=<url corrente, encodeURIComponent>`.
- `login.js`/`register.js`, dopo login/registrazione riusciti, reindirizzano
  a `returnTo` (se presente e valido) invece che a `index.html` fisso.
- I link incrociati fra `login.html` e `register.html` ("Sign up" / "Log
  in") e il link "Back" propagano lo stesso `returnTo`, così non si perde
  se l'utente cambia idea a metà.
- **Validazione**: `returnTo` è accettato solo se è un path relativo interno
  che inizia con uno dei nomi di pagina noti (`index.html`, `lobby.html`) —
  mai un URL assoluto o che inizia con `http`/`//`, per evitare un
  open-redirect. Se assente o non valido, fallback a `index.html` (comportamento
  attuale, invariato).

## Modifiche concrete

1. **`frontend/lobby.html`**: aggiungere un pulsante `id="auth-link"` (stesso
   pattern di `index.html`) nell'header, accanto a Playground/Leave, più gli
   script `shared/firebaseConfig.js` e `hub-auth.js` (già esistenti, non
   modificati nella logica di toggle Login/Logout).
2. **`frontend/hub-auth.js`**: il click su "Login" naviga a
   `login.html?returnTo=<url corrente>` invece che a `login.html` fisso.
   Nessuna modifica al comportamento "Log out" (resta sulla stessa pagina).
3. **`frontend/login.js`** / **`frontend/register.js`**: leggono `returnTo`
   dalla query string, lo validano, e lo usano al posto di `index.html`
   fisso nei tre punti di redirect esistenti (login email/password, login
   Google, registrazione).
4. **`frontend/login.html`** / **`frontend/register.html`**: i link "Sign
   up"/"Log in" e "Back" diventano dinamici (JS che appende lo stesso
   `returnTo` letto dalla propria query string), invece di `href` statici.

## Error handling

- `returnTo` mancante o non valido → fallback silenzioso a `index.html`,
  nessun errore mostrato (comportamento indistinguibile da oggi).
- Login/registrazione falliti (credenziali sbagliate, ecc.): comportamento
  invariato (toast d'errore inline, nessun redirect) — `returnTo` resta
  nella query string per il tentativo successivo, dato che l'utente rimane
  sulla stessa pagina.

## Testing

- Da `index.html` senza sessione: click Login → login → torna su
  `index.html` (comportamento oggi, non deve regredire).
- Da `lobby.html` (arrivo da invito o da hub) senza sessione: click Login →
  login/registrazione → torna sulla STESSA lobby con lo STESSO colore già
  scelto (verifica manuale in localhost con due tab, come da convenzione
  del progetto).
- Da `lobby.html`, passaggio Login → Registrati (o viceversa) a metà: il
  `returnTo` non si perde.
- `returnTo` manomesso con un URL esterno (es. `?returnTo=https://evil.example`):
  ignorato, fallback a `index.html`.
- Sessione già attiva da prima, click su link d'invito: entra in lobby
  riconosciuto, nessun redirect verso login (nessuna regressione).
