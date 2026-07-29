# Sistema Account 4a — Login/Registrazione (Firebase Auth) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere login/registrazione (email+password e Google) alla
piattaforma tramite Firebase Authentication, senza toccare il backend e
senza rompere il flusso guest esistente (entrare in lobby senza login).

**Architecture:** Login/registrazione interamente client-side via
Firebase JS SDK (versione "compat", caricata da CDN con `<script>`
classici — coerente con lo stile del resto del frontend, nessun
bundler/import map). Un file di config condiviso inizializza Firebase;
due nuove pagine (`login.html`, `register.html`) gestiscono le due
azioni; l'hub (`index.html`) mostra un solo link "Login"/"Log out" che
riflette lo stato reale della sessione Firebase.

**Tech Stack:** JavaScript vanilla, Firebase JS SDK v10 "compat"
(`firebase-app-compat.js` + `firebase-auth-compat.js` da
`https://www.gstatic.com/firebasejs/10.12.2/`), nessun test framework nel
frontend di questo repo (pattern esistente: solo backend/fisica hanno
test Jest, il frontend si verifica manualmente in localhost).

## Global Constraints

- **Nessun cambio al backend** (`backend/`) in questo piano — tutto
  client-side. `firebase-admin` e verifica token server-side sono fuori
  scope, arriveranno in un sotto-progetto futuro (4b).
- **Vincolo di prodotto non negoziabile**: mai mostrare email, password,
  username o nome/foto profilo Google in nessuna UI (hub, lobby, HUD di
  gioco). Solo `user.uid` conta per l'identità — non salvarlo/mostrarlo
  da nessuna parte in 4a (non c'è ancora nulla da collegarci).
- **Lingua**: tutte le stringhe UI introdotte in questo piano sono in
  **inglese** (l'hub è in inglese, a differenza dei singoli giochi che
  sono in italiano — vedi CLAUDE.md).
- **Il flusso guest esistente non si tocca**: `Create Lobby` / `Join` /
  `Browse open rooms` in `frontend/index.html` restano identici,
  funzionanti senza alcuna interazione con login.
- **Commit locali sì, push no**: fare commit locali per task come da
  flusso normale del piano — **mai eseguire `git push`**, resta manuale
  e a discrezione dell'utente.
- **Nessun test automatico eseguibile per questo lavoro**: richiede un
  progetto Firebase reale (creato manualmente dall'utente, vedi Task 1)
  e un browser — entrambi fuori dalla portata di un subagent. Ogni task
  qui sotto lo dice esplicitamente dove si applica: fare la parte
  meccanica (file/codice) per intero, riportare la verifica
  reale (browser + progetto Firebase) come pending per l'utente, MAI
  fabbricarla o saltarla in silenzio.
- Riusare lo stile esistente (`frontend/styles/index.css`: classi `.btn`,
  `.btn-create`, `.divider`, `.cancel-link`, il sistema toast già in
  `frontend/index.js`) invece di inventare un nuovo linguaggio visivo.

---

### Task 1: Config Firebase condivisa

**Files:**
- Create: `frontend/shared/firebaseConfig.js`

**Interfaces:**
- Consumes: SDK globale `firebase` (da `firebase-app-compat.js`, caricato
  PRIMA di questo file nell'HTML di ogni pagina che lo usa).
- Produces: variabili globali `firebaseAuth` (istanza `firebase.auth()`,
  o `null` se non configurato) e `firebaseConfigError` (l'errore se la
  config non è stata compilata) — usate da Task 2, 3, 4.

- [ ] **Step 1: Creare il file di config**

Crea `frontend/shared/firebaseConfig.js` con questo contenuto esatto:

```js
// frontend/shared/firebaseConfig.js
//
// Config Firebase per il sistema di login. PASSI MANUALI (una tantum,
// sulla console Firebase: https://console.firebase.google.com) prima
// che questo file funzioni:
//   1. Crea un progetto Firebase nuovo (o riusa uno esistente).
//   2. Authentication -> Sign-in method -> abilita "Email/Password" e
//      "Google".
//   3. Authentication -> Settings -> Authorized domains -> aggiungi il
//      dominio Render effettivo dell'app (es. "tuoapp.onrender.com"),
//      oltre a "localhost" che c'e' gia' di default.
//   4. Project settings -> General -> "Your apps" -> aggiungi una Web
//      app (se non esiste) -> copia i valori mostrati e incollali qui
//      sotto al posto dei placeholder REPLACE_ME.
//
// Questi valori NON sono un segreto: Firebase li protegge tramite gli
// Authorized domains sopra, non tramite segretezza della chiave — è
// normale e sicuro che stiano in un file JS pubblico lato client.

const FIREBASE_CONFIG = {
    apiKey: "REPLACE_ME",
    authDomain: "REPLACE_ME.firebaseapp.com",
    projectId: "REPLACE_ME",
    storageBucket: "REPLACE_ME.appspot.com",
    messagingSenderId: "REPLACE_ME",
    appId: "REPLACE_ME"
};

let firebaseAuth = null;
let firebaseConfigError = null;

try {
    if (FIREBASE_CONFIG.apiKey === "REPLACE_ME") {
        throw new Error(
            "Firebase non configurato: sostituisci i valori REPLACE_ME in " +
            "frontend/shared/firebaseConfig.js con quelli del tuo progetto Firebase."
        );
    }
    firebase.initializeApp(FIREBASE_CONFIG);
    firebaseAuth = firebase.auth();
} catch (err) {
    firebaseConfigError = err;
    console.error('[firebaseConfig]', err.message);
}
```

- [ ] **Step 2: Verifica sintattica statica**

```bash
node --check frontend/shared/firebaseConfig.js
```

Expected: nessun output (exit code 0) — conferma che il file è JS
sintatticamente valido anche se `firebase` non esiste in Node (il
controllo `--check` non esegue il file, solo lo fa parsare).

- [ ] **Step 3: Nota di verifica reale (pending, non eseguibile ora)**

Questo file non produce alcun effetto visibile finché Task 4 (hub) non
lo carica in una pagina reale con Firebase configurato. Non c'è nulla
da verificare in browser in QUESTO task specifico — annotalo nel report
e passa oltre.

- [ ] **Step 4: Commit locale**

```bash
git add frontend/shared/firebaseConfig.js
git commit -m "feat: add shared Firebase config scaffold for account login"
```

---

### Task 2: Pagina di login

**Files:**
- Create: `frontend/login.html`
- Create: `frontend/login.js`
- Create: `frontend/styles/auth.css`

**Interfaces:**
- Consumes: `firebaseAuth` / `firebaseConfigError` (da Task 1,
  `frontend/shared/firebaseConfig.js`), classi CSS esistenti in
  `frontend/styles/index.css` (`.btn`, `.btn-create`, `.divider`,
  `.cancel-link`, `.scene`, `.hero`, `.main-panel`).
- Produces: `frontend/styles/auth.css` (classi `.auth-field`,
  `.btn-google`, `.auth-switch`) — riusato anche da Task 3.

- [ ] **Step 1: Creare lo stylesheet condiviso login/registrazione**

Crea `frontend/styles/auth.css`:

```css
/* frontend/styles/auth.css — pagine login/registrazione (account 4a) */

.auth-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 14px;
    text-align: left;
}

.auth-field label {
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
    letter-spacing: 0.04em;
    text-transform: uppercase;
}

.auth-field input {
    font-family: 'Fredoka', sans-serif;
    font-weight: 600;
    font-size: 16px;
    border: 3px solid var(--ink);
    border-radius: 14px;
    padding: 12px 14px;
    outline: none;
    background: #F7F7F7;
    color: var(--ink);
    transition: box-shadow 0.1s;
    width: 100%;
}

.auth-field input:focus {
    background: #fff;
    box-shadow: 3px 3px 0 var(--ink);
}

.btn-google {
    background: #fff;
    color: var(--ink);
    margin-top: 4px;
    margin-bottom: 12px;
}

.auth-switch {
    margin-top: 4px;
    text-align: center;
    font-size: 14px;
    color: var(--muted);
}

.auth-switch a {
    color: var(--ink);
    font-weight: 700;
    text-decoration: underline;
    text-underline-offset: 3px;
}
```

- [ ] **Step 2: Creare `frontend/login.html`**

```html
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <title>Project-W — Log in</title>
    <link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@400;600;700&family=Space+Mono:wght@700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="styles/index.css" />
    <link rel="stylesheet" href="styles/auth.css" />
</head>

<body>

    <div class="scene">

        <header class="hero">
            <div class="logo-wrap">
                <span class="logo-project">PROJECT</span><span class="logo-w">-W</span>
            </div>
            <p class="tagline">Log in to save your setup.</p>
        </header>

        <main class="main-panel">
            <form id="loginForm">
                <div class="auth-field">
                    <label for="email">Email</label>
                    <input type="email" id="email" autocomplete="email" required>
                </div>
                <div class="auth-field">
                    <label for="password">Password</label>
                    <input type="password" id="password" autocomplete="current-password" required>
                </div>

                <button type="submit" id="login-btn" class="btn btn-create">Log in</button>
                <button type="button" id="google-btn" class="btn btn-google">Log in with Google</button>

                <p class="auth-switch">Don't have an account? <a href="register.html">Sign up</a></p>

                <div class="divider"></div>
                <p class="cancel-link" onclick="window.location.href='index.html'">Back</p>
            </form>
        </main>

    </div>

    <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js"></script>
    <script src="shared/firebaseConfig.js"></script>
    <script src="login.js" defer></script>
</body>

</html>
```

- [ ] **Step 3: Creare `frontend/login.js`**

```js
// frontend/login.js
(function () {
    function showToast(message, type = 'info') {
        let container = document.querySelector('.toast-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'toast-container';
            document.body.appendChild(container);
        }
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        let icon = '';
        if (type === 'error') icon = '⚠️';
        if (type === 'success') icon = '✅';
        toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
    }

    // Messaggi Firebase Auth tradotti in inglese (hub in inglese, vedi
    // CLAUDE.md — solo i giochi restano in italiano).
    const ERROR_MESSAGES = {
        'auth/invalid-email': 'That email address looks invalid.',
        'auth/user-disabled': 'This account has been disabled.',
        'auth/user-not-found': 'No account found with this email.',
        'auth/wrong-password': 'Wrong password.',
        'auth/invalid-credential': 'Wrong email or password.',
        'auth/too-many-requests': 'Too many attempts. Try again later.',
        'auth/popup-closed-by-user': 'Google sign-in was cancelled.'
    };
    function friendlyError(err) {
        return ERROR_MESSAGES[err.code] || 'Something went wrong. Please try again.';
    }

    document.addEventListener('DOMContentLoaded', () => {
        if (typeof firebaseAuth === 'undefined' || !firebaseAuth) {
            showToast('Firebase is not configured yet.', 'error');
            return;
        }

        document.getElementById('loginForm').addEventListener('submit', (e) => {
            e.preventDefault();
            const email = document.getElementById('email').value.trim();
            const password = document.getElementById('password').value;
            firebaseAuth.signInWithEmailAndPassword(email, password)
                .then(() => { window.location.href = 'index.html'; })
                .catch((err) => showToast(friendlyError(err), 'error'));
        });

        document.getElementById('google-btn').addEventListener('click', () => {
            const provider = new firebase.auth.GoogleAuthProvider();
            firebaseAuth.signInWithPopup(provider)
                .then(() => { window.location.href = 'index.html'; })
                .catch((err) => showToast(friendlyError(err), 'error'));
        });
    });
})();
```

- [ ] **Step 4: Verifica sintattica statica**

```bash
node --check frontend/login.js
```

Expected: exit code 0, nessun output.

- [ ] **Step 5: Nota di verifica reale (pending per l'utente)**

Non eseguibile ora: richiede il progetto Firebase configurato (Task 1
completato con valori reali, non `REPLACE_ME`) e un browser. Riportare
nel report che l'utente dovrà: aprire `login.html`, provare login con
email/password valide ed errate (verificare i messaggi in inglese),
provare "Log in with Google", e confermare il redirect a `index.html` in
caso di successo.

- [ ] **Step 6: Commit locale**

```bash
git add frontend/login.html frontend/login.js frontend/styles/auth.css
git commit -m "feat: add login page with email/password and Google sign-in"
```

---

### Task 3: Pagina di registrazione

**Files:**
- Create: `frontend/register.html`
- Create: `frontend/register.js`

**Interfaces:**
- Consumes: `firebaseAuth` (da Task 1), `frontend/styles/auth.css` (da
  Task 2, stesse classi `.auth-field`/`.auth-switch`).
- Produces: nessuna interfaccia nuova per altri task.

- [ ] **Step 1: Creare `frontend/register.html`**

```html
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <title>Project-W — Sign up</title>
    <link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@400;600;700&family=Space+Mono:wght@700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="styles/index.css" />
    <link rel="stylesheet" href="styles/auth.css" />
</head>

<body>

    <div class="scene">

        <header class="hero">
            <div class="logo-wrap">
                <span class="logo-project">PROJECT</span><span class="logo-w">-W</span>
            </div>
            <p class="tagline">Create an account to save your setup.</p>
        </header>

        <main class="main-panel">
            <form id="registerForm">
                <div class="auth-field">
                    <label for="email">Email</label>
                    <input type="email" id="email" autocomplete="email" required>
                </div>
                <div class="auth-field">
                    <label for="password">Password</label>
                    <input type="password" id="password" autocomplete="new-password" required minlength="6">
                </div>
                <div class="auth-field">
                    <label for="confirmPassword">Confirm password</label>
                    <input type="password" id="confirmPassword" autocomplete="new-password" required minlength="6">
                </div>

                <button type="submit" id="register-btn" class="btn btn-create">Sign up</button>

                <p class="auth-switch">Already have an account? <a href="login.html">Log in</a></p>

                <div class="divider"></div>
                <p class="cancel-link" onclick="window.location.href='index.html'">Back</p>
            </form>
        </main>

    </div>

    <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js"></script>
    <script src="shared/firebaseConfig.js"></script>
    <script src="register.js" defer></script>
</body>

</html>
```

Nota: nessun pulsante "Sign up with Google" — un login Google la prima
volta crea già l'account automaticamente (Firebase unifica login/signup
per i provider OAuth), quindi quel pulsante esiste solo in `login.html`.
Non è una dimenticanza.

- [ ] **Step 2: Creare `frontend/register.js`**

```js
// frontend/register.js
(function () {
    function showToast(message, type = 'info') {
        let container = document.querySelector('.toast-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'toast-container';
            document.body.appendChild(container);
        }
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        let icon = '';
        if (type === 'error') icon = '⚠️';
        if (type === 'success') icon = '✅';
        toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
    }

    const ERROR_MESSAGES = {
        'auth/email-already-in-use': 'An account already exists with this email.',
        'auth/invalid-email': 'That email address looks invalid.',
        'auth/weak-password': 'Password should be at least 6 characters.'
    };
    function friendlyError(err) {
        return ERROR_MESSAGES[err.code] || 'Something went wrong. Please try again.';
    }

    document.addEventListener('DOMContentLoaded', () => {
        if (typeof firebaseAuth === 'undefined' || !firebaseAuth) {
            showToast('Firebase is not configured yet.', 'error');
            return;
        }

        document.getElementById('registerForm').addEventListener('submit', (e) => {
            e.preventDefault();
            const email = document.getElementById('email').value.trim();
            const password = document.getElementById('password').value;
            const confirmPassword = document.getElementById('confirmPassword').value;

            if (password !== confirmPassword) {
                showToast('Passwords do not match.', 'error');
                return;
            }

            firebaseAuth.createUserWithEmailAndPassword(email, password)
                .then(() => { window.location.href = 'index.html'; })
                .catch((err) => showToast(friendlyError(err), 'error'));
        });
    });
})();
```

- [ ] **Step 3: Verifica sintattica statica**

```bash
node --check frontend/register.js
```

Expected: exit code 0, nessun output.

- [ ] **Step 4: Nota di verifica reale (pending per l'utente)**

Stessa nota del Task 2: richiede progetto Firebase configurato + browser.
Riportare che l'utente dovrà provare registrazione con email nuova,
email già in uso, password troppo corta, password non coincidenti, e
confermare il redirect a `index.html` in caso di successo.

- [ ] **Step 5: Commit locale**

```bash
git add frontend/register.html frontend/register.js
git commit -m "feat: add sign-up page with email/password registration"
```

---

### Task 4: Wiring dell'hub (index.html)

**Files:**
- Modify: `frontend/index.html`
- Create: `frontend/hub-auth.js`

**Interfaces:**
- Consumes: `firebaseAuth` (da Task 1), `login.html` (da Task 2, come
  destinazione del link quando l'utente non è loggato).
- Produces: nessuna interfaccia nuova per altri task (ultimo task del
  piano).

- [ ] **Step 1: Aggiungere il link Login/Log out a `frontend/index.html`**

Nel blocco `<header class="hero">` esistente, subito dopo il tag
`<p class="tagline">...</p>` esistente (senza toccare nient'altro del
resto del file: color-picker, form, modal restano identici), aggiungere:

```html
            <p id="auth-link" class="cancel-link" style="margin-top: 6px;">Login</p>
```

Poi, subito prima della chiusura `</body>` esistente (dopo lo
`<script src="index.js" defer></script>` già presente, senza rimuoverlo
né modificarlo), aggiungere i nuovi script:

```html
    <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js"></script>
    <script src="shared/firebaseConfig.js"></script>
    <script src="hub-auth.js" defer></script>
```

- [ ] **Step 2: Creare `frontend/hub-auth.js`**

```js
// frontend/hub-auth.js
(function () {
    document.addEventListener('DOMContentLoaded', () => {
        const link = document.getElementById('auth-link');
        if (!link) return;

        function showLoggedOut() {
            link.textContent = 'Login';
            link.onclick = () => { window.location.href = 'login.html'; };
        }

        if (typeof firebaseAuth === 'undefined' || !firebaseAuth) {
            showLoggedOut();
            return;
        }

        firebaseAuth.onAuthStateChanged((user) => {
            if (user) {
                link.textContent = 'Log out';
                link.onclick = () => firebaseAuth.signOut();
            } else {
                showLoggedOut();
            }
        });
    });
})();
```

- [ ] **Step 3: Verifica sintattica statica**

```bash
node --check frontend/hub-auth.js
```

Expected: exit code 0, nessun output.

- [ ] **Step 4: Verifica strutturale che il flusso esistente non sia stato toccato**

```bash
git diff frontend/index.html
```

Expected: il diff mostra SOLO l'aggiunta della riga `<p id="auth-link"...>`
nell'header e le 4 righe di `<script>` prima di `</body>` — nessuna
riga del form (`colorForm`, `color-picker`, `create-btn`, `join-group`,
`browse-btn`, il modal `lobbies-modal`) risulta rimossa o modificata.

- [ ] **Step 5: Nota di verifica reale (pending per l'utente)**

Non eseguibile ora (richiede Firebase configurato + browser). Riportare
che l'utente dovrà: aprire `index.html` SENZA aver fatto login e
confermare che tutto il flusso esistente (scegliere colore, Create
Lobby, Join, Browse open rooms) funziona esattamente come prima; poi
fare login da `login.html` e tornare su `index.html`, confermando che il
link ora dice "Log out" e che cliccandolo si torna allo stato "Login"
senza reload manuale della pagina (grazie a `onAuthStateChanged`).

- [ ] **Step 6: Commit locale**

```bash
git add frontend/index.html frontend/hub-auth.js
git commit -m "feat: wire up login/logout state in the hub"
```

---

## Note di chiusura

- Nessun push: tutti i commit restano locali su un branch dedicato,
  come da accordo con l'utente — il push su GitHub è manuale.
- Fuori scope (vedi spec
  `docs/superpowers/specs/2026-07-29-account-system-4a-auth-design.md`):
  qualsiasi collegamento tra l'utente Firebase e dati di gioco (livrea,
  leaderboard) — è il prossimo sotto-progetto (4b), da brainstormare a
  parte quando questo sarà chiuso e verificato dall'utente in
  locale/Render.
- Prima che QUALSIASI parte di questo sia testabile per davvero, l'utente
  deve completare i passi manuali del Task 1 (creare il progetto Firebase,
  abilitare i provider, aggiungere gli Authorized domains, incollare la
  config reale in `firebaseConfig.js`) — nessun task di questo piano può
  farlo al posto suo.
