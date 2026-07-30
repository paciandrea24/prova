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
