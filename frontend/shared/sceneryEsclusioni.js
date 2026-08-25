// frontend/shared/sceneryEsclusioni.js
//
// GLI OGGETTI CHE L'AUTORE HA TOLTO A MANO dalla scenografia generata.
//
// PERCHÉ ESISTE. La porta della scenografia (`sceneryRegistro`) garantisce che
// niente con un ingombro dichiarato entri nella carreggiata, su qualsiasi
// pista. Ma non garantisce il 100%: restano le esenzioni per mestiere
// (`A_BORDO_PISTA`, `SCAVALCANO`), i portali sproporzionati dove le vie di
// fuga sono larghe, e i difetti che nessuno ha ancora misurato. Serve una
// valvola manuale — non una selezione libera in 3D, ma un «togli questo»
// accanto alla segnalazione che il validatore ti sta già mostrando.
// Rif. docs/superpowers/specs/2026-08-25-f1-densita-scenografia-design.md
//
// ⚠️ L'IDENTIFICATORE NON PUÒ ESSERE L'INDICE nell'array del layout: cambia
// appena si tocca l'algoritmo di posizionamento — ed è successo lo stesso
// giorno in cui questo modulo è nato, quando le schiere di tribune hanno smesso
// di avere un tetto e shanghai è passata da 139 a 243 tribune. Un indice
// salvato ieri toglierebbe oggi un oggetto diverso, in silenzio.
//
// Si usa invece asset + posizione, arrotondata al decimo. Non è eterno neanche
// lui — se l'oggetto si sposta, l'esclusione non lo trova più — ma quando
// succede il modulo lo DICE (`nonTrovate`) invece di far finta di niente. Un
// filtro che non trova il suo bersaglio e tace è la stessa trappola del
// fallback silenzioso che ha fatto finire due container in pista.
//
// Modulo PURO: niente Three, niente DOM, niente fs.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.SceneryEsclusioni = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    // Il decimo di unità è più fine di qualunque spostamento che il caso
    // possa produrre e più grosso del rumore in virgola mobile fra una
    // generazione e l'altra (il layout è deterministico, ma passa da JSON e
    // torna indietro quando la pista è cotta).
    function idDi(voce) {
        if (!voce || !voce.asset) return null;
        return voce.asset + '@' + voce.x.toFixed(1) + ',' + voce.z.toFixed(1);
    }

    // Toglie dal layout gli oggetti elencati e dice quali non ha trovato.
    //
    // Restituisce SEMPRE un nuovo array, anche quando non c'è niente da
    // togliere: chi chiama non deve dover sapere se il filtro ha lavorato.
    function applica(layout, esclusi) {
        const lista = Array.isArray(esclusi) ? esclusi.filter(Boolean) : [];
        if (!lista.length) return { layout: (layout || []).slice(), nonTrovate: [] };

        const cercati = new Set(lista);
        const trovati = new Set();
        const rimasti = [];
        for (const v of layout || []) {
            const id = idDi(v);
            if (id && cercati.has(id)) { trovati.add(id); continue; }
            rimasti.push(v);
        }
        return { layout: rimasti, nonTrovate: lista.filter(id => !trovati.has(id)) };
    }

    return { idDi, applica };
});
