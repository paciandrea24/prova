// backend/middleware/sicurezzaHttp.js
//
// Due cose che il browser sa fare da solo per proteggere chi apre le nostre
// pagine, ma solo se glielo diciamo con le intestazioni giuste.

// Chi può chiamare le nostre API da un'altra origine.
//
// Prima era `cors()` senza argomenti, cioè "chiunque". Il frontend però è
// servito dallo stesso Express delle API: nessuna pagina nostra fa una
// chiamata cross-origin, quindi quella porta era aperta solo per gli altri.
//
// Ora è chiusa, e si riapre solo elencando le origini in
// ORIGINI_CONSENTITE (separate da virgola) — serve se un giorno il gioco
// verrà servito da un dominio diverso da quello delle API.
function corsRistretto(cors) {
    const elenco = (process.env.ORIGINI_CONSENTITE || '')
        .split(',').map((s) => s.trim()).filter(Boolean);

    if (elenco.length === 0) return cors({ origin: false });
    return cors({ origin: elenco });
}

// Intestazioni di base. Non c'è una Content-Security-Policy perché le pagine
// usano stili e gestori scritti dentro l'HTML: una policy stretta le
// spegnerebbe, e una policy larga non protegge da niente. Va fatta insieme a
// una ripulita dell'HTML, ed è un lavoro a sé.
function intestazioniDiSicurezza(req, res, next) {
    // "Non indovinare il tipo di questo file": senza, un browser può decidere
    // che un file caricato come immagine è in realtà HTML, ed eseguirlo.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Nessuno può incorniciare il gioco dentro una propria pagina per farci
    // cliccare sopra qualcos'altro.
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    // L'indirizzo completo della pagina (che contiene il numero della stanza)
    // non viene passato ai siti esterni che dovessimo linkare.
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
}

module.exports = { corsRistretto, intestazioniDiSicurezza };
