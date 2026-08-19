// frontend/shared/f1Pneumatico.js
//
// Il disegno di uno pneumatico visto di lato, in SVG.
//
// Nasce dal riferimento portato dall'utente (infografica Pirelli di un weekend
// di gara): «voglio quella stessa rappresentazione per i pneumatici, voglio
// vederli così». Prima erano tre riquadri con un pallino colorato dentro — una
// legenda, non una gomma — e la mescola si sceglieva leggendo, non guardando.
//
// PERCHÉ SVG E NON UN'IMMAGINE. Tre motivi, in ordine di importanza: il colore
// della fascia viene dalla stessa tabella delle mescole che usa il server
// (TYRE_COMPOUNDS), quindi aggiungere una mescola non richiede un file nuovo;
// scala senza sfocare su qualunque schermo; e non aggiunge un asset da caricare
// a una schermata che esiste anche per dare tempo al caricamento del circuito.
//
// PERCHÉ UN MODULO A PARTE. Lo stesso pneumatico serve in almeno tre posti — la
// pagina di scelta mescola, il pannello in corsia box e (prossimamente) il
// pannello del tasto T — e tre copie dello stesso SVG diventano tre disegni
// leggermente diversi alla prima modifica.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.F1Pneumatico = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    // Il disegno è costruito su un riquadro di 100×100 e scalato da chi lo usa:
    // tutte le misure qui sotto sono in quelle unità.
    const VIEWBOX = 100;
    const CENTRO = VIEWBOX / 2;

    const R_ESTERNO = 47;      // bordo del battistrada
    const R_FASCIA = 40;       // la banda colorata sul fianco, il segno Pirelli
    const R_SPALLA = 33;       // dove il fianco incontra il cerchio
    const R_CERCHIO = 24;      // il cerchio in lega
    const R_MOZZO = 7;

    const RAZZE = 7;
    const SCANALATURE = 24;    // tacche del battistrada lungo la circonferenza

    // Quante tacche mostrare per mescola: una gomma dura ha il battistrada più
    // fitto e compatto, una morbida più aperto. È l'unico modo per distinguerle
    // a colpo d'occhio anche a colori spenti — e in una schermata dove il
    // giocatore sceglie in fretta, il colore da solo non basta.
    const TACCHE_PER_MESCOLA = { hard: 1, medium: 0.75, soft: 0.5 };

    function polare(angoloRad, raggio) {
        return {
            x: CENTRO + Math.cos(angoloRad) * raggio,
            y: CENTRO + Math.sin(angoloRad) * raggio,
        };
    }

    // Le tacche del battistrada: segmenti radiali fra il bordo esterno e la
    // fascia. Non è decorazione — è ciò che rende il cerchio uno PNEUMATICO
    // invece di un anello.
    function battistrada(mescola) {
        const densita = TACCHE_PER_MESCOLA[mescola] != null ? TACCHE_PER_MESCOLA[mescola] : 0.75;
        const quante = Math.max(6, Math.round(SCANALATURE * densita));
        let out = '';
        for (let i = 0; i < quante; i++) {
            const a = (i / quante) * Math.PI * 2;
            const da = polare(a, R_FASCIA + 1.5);
            const a2 = polare(a, R_ESTERNO - 1.5);
            out += `<line x1="${da.x.toFixed(2)}" y1="${da.y.toFixed(2)}"`
                + ` x2="${a2.x.toFixed(2)}" y2="${a2.y.toFixed(2)}"`
                + ` stroke="#0b0b0c" stroke-width="2.6" stroke-linecap="round"/>`;
        }
        return out;
    }

    function razze() {
        let out = '';
        for (let i = 0; i < RAZZE; i++) {
            const a = (i / RAZZE) * Math.PI * 2 - Math.PI / 2;
            const da = polare(a, R_MOZZO + 1.5);
            const a2 = polare(a, R_CERCHIO - 2);
            out += `<line x1="${da.x.toFixed(2)}" y1="${da.y.toFixed(2)}"`
                + ` x2="${a2.x.toFixed(2)}" y2="${a2.y.toFixed(2)}"`
                + ` stroke="#8f9aa6" stroke-width="3.4" stroke-linecap="round"/>`;
        }
        return out;
    }

    // `colore` è quello della mescola nella tabella del server: la fascia è
    // l'unica parte colorata, esattamente come sulle gomme vere.
    function svg(mescola, colore, { classe = '', titolo = '' } = {}) {
        const c = colore || '#cfd6dd';
        return `<svg class="pneumatico ${classe}" viewBox="0 0 ${VIEWBOX} ${VIEWBOX}" role="img"`
            + (titolo ? ` aria-label="${titolo}"` : ' aria-hidden="true"')
            + `>`
            + (titolo ? `<title>${titolo}</title>` : '')
            // Gomma: il disco scuro di base.
            + `<circle cx="${CENTRO}" cy="${CENTRO}" r="${R_ESTERNO}" fill="#17181b"/>`
            + battistrada(mescola)
            // Fascia colorata. Il tratto è spesso perché a questa scala una
            // linea sottile sparisce, ed è l'unica cosa che dice quale mescola è.
            + `<circle cx="${CENTRO}" cy="${CENTRO}" r="${R_FASCIA}" fill="none" stroke="${c}" stroke-width="4.6"/>`
            // Fianco, con un accenno di rilievo verso il cerchio.
            + `<circle cx="${CENTRO}" cy="${CENTRO}" r="${R_SPALLA}" fill="#1f2126"/>`
            + `<circle cx="${CENTRO}" cy="${CENTRO}" r="${R_SPALLA}" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="1.4"/>`
            // Cerchio in lega.
            + `<circle cx="${CENTRO}" cy="${CENTRO}" r="${R_CERCHIO}" fill="#2c3138" stroke="#aab4c0" stroke-width="2"/>`
            + razze()
            + `<circle cx="${CENTRO}" cy="${CENTRO}" r="${R_MOZZO}" fill="#cfd6dd"/>`
            + `</svg>`;
    }

    return {
        svg,
        VIEWBOX, R_ESTERNO, R_FASCIA, R_CERCHIO, RAZZE, SCANALATURE, TACCHE_PER_MESCOLA,
    };

});
