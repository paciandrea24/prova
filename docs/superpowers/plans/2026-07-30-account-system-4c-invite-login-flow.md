# Account system 4c: login raggiungibile da invito/lobby (returnTo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendere il login/registrazione raggiungibile da qualunque punto del flusso pre-gara (hub e lobby, non solo l'hub) e far tornare l'utente esattamente dove si trovava dopo il successo, senza introdurre alcun gate obbligatorio né un pulsante "continua come ospite".

**Architecture:** Un piccolo modulo condiviso `frontend/shared/returnTo.js` (stesso pattern UMD di `carLoader.js`/`voxelizer.js`) centralizza la logica di lettura/validazione/costruzione del parametro `returnTo`. `lobby.html` guadagna lo stesso pulsante Login già presente su `index.html` (oggi assente). `hub-auth.js`, `login.js`, `register.js` e i link incrociati di `login.html`/`register.html` vengono aggiornati per propagare `returnTo` invece di puntare sempre a `index.html`.

**Tech Stack:** JS vanilla lato client, Firebase Auth SDK (già in uso), `node:test` per i test della logica pura (stesso pattern di `frontend/shared/carLoader.test.js`).

## Global Constraints

- Nessun gate di login obbligatorio, nessun pulsante "continua come ospite": il comportamento passivo attuale (guest di default se non si interagisce col pulsante Login) resta invariato.
- `returnTo` è accettato solo se path relativo interno che inizia con `index.html` o `lobby.html` — mai un URL assoluto o protocol-relative (`http://`, `https://`, `//`), per evitare un open-redirect. Se assente o non valido, fallback silenzioso a `index.html`.
- Fuori scope: il meccanismo d'invito stesso (`/index.html?join=<lobbyId>`, invariato), `f1.html`/`livery.html` (non ricevono un pulsante Login), il caricamento della livrea in gara (già implementato, non toccare).
- Comunicazioni/commenti nel codice in italiano (convenzione del progetto).

---

### Task 1: Modulo condiviso `returnTo.js`

**Files:**
- Create: `frontend/shared/returnTo.js`
- Create: `frontend/shared/returnTo.test.js`

**Interfaces:**
- Produces (usato dai Task 2 e 3): global `ReturnTo` (UMD, esportato anche via `module.exports` per i test — stesso pattern di `frontend/shared/carLoader.js`) con:
  - `ReturnTo.isValid(value: string|null) -> boolean`
  - `ReturnTo.parseReturnTo(search: string) -> string|null`
  - `ReturnTo.buildHereAsReturnTo(pathname: string, search: string) -> string`
  - `ReturnTo.read() -> string|null` (legge `window.location.search`)
  - `ReturnTo.hereAsReturnTo() -> string` (legge `window.location.pathname`/`.search`)
  - `ReturnTo.wireAuthPage() -> void` (side effect su DOM: vedi Task 3)

- [ ] **Step 1: Scrivi il test che fallisce**

Crea `frontend/shared/returnTo.test.js`:

```js
// frontend/shared/returnTo.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const ReturnTo = require('./returnTo.js');

test('isValid accetta index.html senza query', () => {
    assert.equal(ReturnTo.isValid('index.html'), true);
});

test('isValid accetta lobby.html con query', () => {
    assert.equal(ReturnTo.isValid('lobby.html?lobby=ABC12&color=%23FF0000'), true);
});

test('isValid rifiuta un URL assoluto esterno (http)', () => {
    assert.equal(ReturnTo.isValid('http://evil.example/'), false);
});

test('isValid rifiuta un URL assoluto esterno (https)', () => {
    assert.equal(ReturnTo.isValid('https://evil.example/'), false);
});

test('isValid rifiuta un protocol-relative URL (//)', () => {
    assert.equal(ReturnTo.isValid('//evil.example/'), false);
});

test('isValid rifiuta una pagina non in whitelist', () => {
    assert.equal(ReturnTo.isValid('f1.html'), false);
});

test('isValid rifiuta valore vuoto/assente', () => {
    assert.equal(ReturnTo.isValid(''), false);
    assert.equal(ReturnTo.isValid(null), false);
    assert.equal(ReturnTo.isValid(undefined), false);
});

test('parseReturnTo estrae e valida returnTo da una query string', () => {
    const search = '?returnTo=' + encodeURIComponent('lobby.html?lobby=ABC12&color=%23FF0000');
    assert.equal(ReturnTo.parseReturnTo(search), 'lobby.html?lobby=ABC12&color=%23FF0000');
});

test('parseReturnTo torna null se il parametro manca', () => {
    assert.equal(ReturnTo.parseReturnTo(''), null);
});

test('parseReturnTo torna null se il valore non e\' valido (open-redirect)', () => {
    const search = '?returnTo=' + encodeURIComponent('https://evil.example/');
    assert.equal(ReturnTo.parseReturnTo(search), null);
});

test('buildHereAsReturnTo compone pagina+query dal pathname corrente', () => {
    assert.equal(
        ReturnTo.buildHereAsReturnTo('/lobby.html', '?lobby=ABC12&color=%23FF0000'),
        'lobby.html?lobby=ABC12&color=%23FF0000'
    );
});

test('buildHereAsReturnTo funziona anche senza query string', () => {
    assert.equal(ReturnTo.buildHereAsReturnTo('/index.html', ''), 'index.html');
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Run: `node --test frontend/shared/returnTo.test.js`
Expected: FAIL — `Cannot find module './returnTo.js'` (il file non esiste ancora).

- [ ] **Step 3: Scrivi l'implementazione minima**

Crea `frontend/shared/returnTo.js`:

```js
// frontend/shared/returnTo.js
//
// Centralizza lettura/validazione/costruzione del parametro `returnTo`
// usato per far tornare l'utente esattamente da dove era partito dopo un
// login/registrazione (es. da dentro lobby.html, non solo da index.html —
// vedi docs/superpowers/specs/2026-07-30-account-system-4c-invite-login-flow-design.md).
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ReturnTo = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    // Uniche pagine verso cui è lecito tornare: whitelist esplicita, non un
    // controllo "non è un URL esterno" — previene un open-redirect anche se
    // qualcuno passa un valore che assomiglia a un path relativo ma con
    // trucchi (es. `index.html@evil.example`, comunque bloccato perché non
    // è uguale né inizia per "index.html?").
    const ALLOWED_PAGES = ['index.html', 'lobby.html'];

    function isValid(value) {
        if (!value) return false;
        if (/^https?:\/\//i.test(value) || value.startsWith('//')) return false;
        return ALLOWED_PAGES.some((page) => value === page || value.startsWith(page + '?'));
    }

    // Estrae e valida returnTo da una query string (es. "?returnTo=...").
    // null se assente o non valido.
    function parseReturnTo(search) {
        const value = new URLSearchParams(search).get('returnTo');
        return isValid(value) ? value : null;
    }

    // "pagina.html?query" dati pathname+search correnti — da passare come
    // returnTo quando si naviga VERSO login.html/register.html.
    function buildHereAsReturnTo(pathname, search) {
        const page = pathname.split('/').pop();
        return page + search;
    }

    function read() {
        return parseReturnTo(window.location.search);
    }

    function hereAsReturnTo() {
        return buildHereAsReturnTo(window.location.pathname, window.location.search);
    }

    // Su login.html/register.html: propaga lo stesso returnTo già presente
    // nella query string corrente sul link "Sign up"/"Log in" (siamo ancora
    // a metà flusso, non autenticati), e fa tornare "Back" DIRETTAMENTE
    // all'origine (mai a index.html con un returnTo appeso — Back è un
    // annulla, non un altro giro di redirect).
    function wireAuthPage() {
        const target = read();
        const suffix = target ? ('?returnTo=' + encodeURIComponent(target)) : '';

        const switchLink = document.querySelector('.auth-switch a');
        if (switchLink) {
            const base = switchLink.getAttribute('href').split('?')[0];
            switchLink.href = base + suffix;
        }

        const backLink = document.querySelector('.cancel-link');
        if (backLink) {
            backLink.onclick = () => { window.location.href = target || 'index.html'; };
        }
    }

    return { isValid, parseReturnTo, buildHereAsReturnTo, read, hereAsReturnTo, wireAuthPage };
});
```

- [ ] **Step 4: Esegui il test e verifica che passi**

Run: `node --test frontend/shared/returnTo.test.js`
Expected: PASS, tutti i test verdi.

- [ ] **Step 5: Commit**

```bash
git add frontend/shared/returnTo.js frontend/shared/returnTo.test.js
git commit -m "Account system 4c: modulo condiviso returnTo (lettura/validazione/costruzione)"
```

---

### Task 2: Login raggiungibile da `lobby.html`

**Files:**
- Modify: `frontend/index.html` (aggiungere script tag `shared/returnTo.js`)
- Modify: `frontend/lobby.html` (aggiungere pulsante Login + script tag Firebase/returnTo/hub-auth)
- Modify: `frontend/styles/lobby.css` (stile del nuovo pulsante)
- Modify: `frontend/hub-auth.js` (usare `ReturnTo.hereAsReturnTo()` invece di un URL fisso)

**Interfaces:**
- Consumes: `ReturnTo.hereAsReturnTo() -> string` (Task 1).
- Produces: nessuna nuova interfaccia — comportamento verificabile solo manualmente (click su Login da `index.html` e da `lobby.html`).

- [ ] **Step 1: Aggiungi `returnTo.js` all'head-script di `index.html`**

In `frontend/index.html`, riga 84 (subito prima di `hub-auth.js`):

```html
    <script src="shared/firebaseConfig.js" defer></script>
    <script src="shared/returnTo.js" defer></script>
    <script src="hub-auth.js" defer></script>
```

- [ ] **Step 2: Aggiorna `hub-auth.js` per usare `ReturnTo`**

Sostituisci il contenuto di `frontend/hub-auth.js`:

```js
// frontend/hub-auth.js
(function () {
    document.addEventListener('DOMContentLoaded', () => {
        const link = document.getElementById('auth-link');
        if (!link) return;

        function loginUrl() {
            return 'login.html?returnTo=' + encodeURIComponent(ReturnTo.hereAsReturnTo());
        }

        function showLoggedOut() {
            link.textContent = 'Login';
            link.onclick = () => { window.location.href = loginUrl(); };
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

- [ ] **Step 3: Aggiungi il pulsante Login all'header di `lobby.html`**

In `frontend/lobby.html`, dentro `<div class="header">` (riga 15-30), subito prima del pulsante Leave:

```html
        <button id="auth-link" type="button" class="btn-auth">Login</button>
        <button id="leave-lobby-btn" class="btn-leave">Leave</button>
```

- [ ] **Step 4: Aggiungi lo stile `.btn-auth` a `lobby.css`**

In `frontend/styles/lobby.css`, subito dopo il blocco `.btn-leave` (dopo la riga con `.btn-leave:active`):

```css
.btn-auth {
    margin-left: 0;
    font-family: 'Fredoka', sans-serif;
    font-weight: 700;
    font-size: 15px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    background: none;
    color: var(--blue);
    border: 3px solid var(--blue);
    border-radius: 12px;
    padding: 8px 18px;
    cursor: pointer;
    box-shadow: 4px 4px 0 var(--blue);
    transition: transform 0.1s, box-shadow 0.1s, background 0.1s, color 0.1s;
}
.btn-auth:hover  { background: var(--blue); color: #fff; transform: translateY(-2px); box-shadow: 4px 6px 0 var(--blue); }
.btn-auth:active { transform: translate(4px,4px); box-shadow: none; }
```

- [ ] **Step 5: Aggiungi gli script Firebase/returnTo/hub-auth a `lobby.html`**

In `frontend/lobby.html`, subito prima di `</body>` (dopo `<script src="playground.js" defer></script>`):

```html
<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js" defer></script>
<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js" defer></script>
<script src="shared/firebaseConfig.js" defer></script>
<script src="shared/returnTo.js" defer></script>
<script src="hub-auth.js" defer></script>
```

- [ ] **Step 6: Verifica manuale in localhost**

Avvia `node server.js` da `backend/`, apri `localhost:3000`:
1. Da `index.html` senza sessione attiva: click "Login" → l'URL di `login.html` deve contenere `?returnTo=index.html` (controllare nella barra indirizzi).
2. Crea/entra in una lobby, poi click "Login" dall'header della lobby → l'URL di `login.html` deve contenere `?returnTo=lobby.html%3Flobby%3D...%26color%3D...` (il lobbyId/colore reali della lobby corrente).
3. Se già loggato (sessione precedente), il pulsante mostra "Log out" sia su `index.html` sia su `lobby.html`, e cliccandolo si torna ospite sulla stessa pagina (nessun redirect) — comportamento invariato.

- [ ] **Step 7: Commit**

```bash
git add frontend/index.html frontend/lobby.html frontend/styles/lobby.css frontend/hub-auth.js
git commit -m "Account system 4c: pulsante Login raggiungibile anche da lobby.html (returnTo)"
```

---

### Task 3: `login.html`/`register.html` consumano e propagano `returnTo`

**Files:**
- Modify: `frontend/login.html` (script tag `returnTo.js`, rimuovi `onclick` statico dal link Back)
- Modify: `frontend/register.html` (idem)
- Modify: `frontend/login.js` (redirect post-successo a `returnTo`, chiama `ReturnTo.wireAuthPage()`)
- Modify: `frontend/register.js` (idem)

**Interfaces:**
- Consumes: `ReturnTo.read() -> string|null`, `ReturnTo.wireAuthPage() -> void` (Task 1).

- [ ] **Step 1: Aggiorna `login.html`**

In `frontend/login.html`:

Rimuovi l'`onclick` statico dal link Back (riga 41):
```html
                <p class="cancel-link">Back</p>
```

Aggiungi `returnTo.js` prima di `login.js` (riga 49-50):
```html
    <script src="shared/firebaseConfig.js" defer></script>
    <script src="shared/returnTo.js" defer></script>
    <script src="login.js" defer></script>
```

- [ ] **Step 2: Aggiorna `register.html`**

In `frontend/register.html`, stesse due modifiche: rimuovi l'`onclick` statico dal link Back (riga 44):
```html
                <p class="cancel-link">Back</p>
```

Aggiungi `returnTo.js` prima di `register.js` (riga 52-53):
```html
    <script src="shared/firebaseConfig.js" defer></script>
    <script src="shared/returnTo.js" defer></script>
    <script src="register.js" defer></script>
```

- [ ] **Step 3: Aggiorna `login.js`**

Sostituisci il contenuto di `frontend/login.js`:

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
        'auth/popup-closed-by-user': 'Google sign-in was cancelled.',
        'auth/unauthorized-domain': 'This domain is not authorized for sign-in yet.',
        'auth/operation-not-allowed': 'This sign-in method is not enabled.',
        'auth/popup-blocked': 'Your browser blocked the sign-in popup. Please allow popups and try again.',
        'auth/network-request-failed': 'Network error. Check your connection and try again.'
    };
    function friendlyError(err) {
        console.error('[auth]', err.code, err.message);
        return ERROR_MESSAGES[err.code] || 'Something went wrong. Please try again.';
    }

    document.addEventListener('DOMContentLoaded', () => {
        ReturnTo.wireAuthPage();

        if (typeof firebaseAuth === 'undefined' || !firebaseAuth) {
            showToast('Firebase is not configured yet.', 'error');
            return;
        }

        document.getElementById('loginForm').addEventListener('submit', (e) => {
            e.preventDefault();
            const email = document.getElementById('email').value.trim();
            const password = document.getElementById('password').value;
            firebaseAuth.signInWithEmailAndPassword(email, password)
                .then(() => { window.location.href = ReturnTo.read() || 'index.html'; })
                .catch((err) => showToast(friendlyError(err), 'error'));
        });

        document.getElementById('google-btn').addEventListener('click', () => {
            const provider = new firebase.auth.GoogleAuthProvider();
            firebaseAuth.signInWithPopup(provider)
                .then(() => { window.location.href = ReturnTo.read() || 'index.html'; })
                .catch((err) => showToast(friendlyError(err), 'error'));
        });
    });
})();
```

- [ ] **Step 4: Aggiorna `register.js`**

Sostituisci il contenuto di `frontend/register.js`:

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
        console.error('[auth]', err.code, err.message);
        return ERROR_MESSAGES[err.code] || 'Something went wrong. Please try again.';
    }

    document.addEventListener('DOMContentLoaded', () => {
        ReturnTo.wireAuthPage();

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
                .then(() => { window.location.href = ReturnTo.read() || 'index.html'; })
                .catch((err) => showToast(friendlyError(err), 'error'));
        });
    });
})();
```

- [ ] **Step 5: Verifica manuale in localhost — round trip completo**

Avvia `node server.js` da `backend/`, apri `localhost:3000` in due tab (uno per simulare l'host, uno per l'invitato):
1. Host crea una lobby, prende il link d'invito, lo apre nell'altro tab (o naviga direttamente a `lobby.html?lobby=<id>&color=<colore>` dopo aver scelto un colore da `index.html?join=<id>`).
2. Nel tab "invitato", senza sessione Firebase attiva, click "Login" nell'header della lobby.
3. Compila e invia il form di login (o registrati se non hai un account di test) → dopo il successo, verifica di essere tornato **sulla stessa lobby, con lo stesso colore già scelto** (non su `index.html`).
4. Ripeti passando da "Sign up" a "Log in" (o viceversa) a metà flusso: verifica che il redirect finale funzioni comunque correttamente (il `returnTo` non si è perso).
5. Prova il link "Back" da `login.html`/`register.html`: deve tornare direttamente alla lobby (non a `index.html`).
6. Da `index.html` senza alcun `returnTo` (es. navigazione diretta a `login.html` digitando l'URL): dopo il login, verifica che il redirect vada comunque a `index.html` (fallback, nessuna regressione).

- [ ] **Step 6: Commit**

```bash
git add frontend/login.html frontend/register.html frontend/login.js frontend/register.js
git commit -m "Account system 4c: login.html/register.html consumano e propagano returnTo"
```
