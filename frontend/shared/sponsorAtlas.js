// frontend/shared/sponsorAtlas.js
//
// I cartelloni pubblicitari a bordo pista: chi sono e in che ordine si
// susseguono lungo il giro.
//
// ⚠️ MARCHI INVENTATI, e nessuno che sia la storpiatura riconoscibile di un
// marchio vero: e' una regola del progetto dal 2026-08-27, e vale anche
// quando la parodia sarebbe divertente.
//
// Modulo puro, nessuna dipendenza da Three: qui si decide COSA e DOVE, il
// disegno lo fa toonStyle e la geometria trackMeshBuilder.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./toonPalette.js'), require('./semeStabile.js'));
    } else {
        root.SponsorAtlas = factory(root.ToonPalette, root.SemeStabile);
    }
})(typeof self !== 'undefined' ? self : this, function (Palette, Seme) {

    // Quanto e' lungo un pannello in unita' di gioco. La pista e' larga 22:
    // un cartellone da 12 e' poco piu' di mezza carreggiata, la proporzione
    // dei pannelli veri a bordo pista.
    const LUNGHEZZA_PANNELLO = 12;

    const NOMI = [
        'VELOCE', 'AEROTEC', 'NOVARIS', 'KILOVOLT', 'FULMINE',
        'ORBITEC', 'VERTICE', 'LAMPO', 'CRONOMAX', 'TURBINA',
        'ASSOLUTA', 'QUADRANTE', 'IPERION', 'MERIDIA', 'VOLTARIS',
        'ALTAVIA', 'BOREALE', 'ZEFIRO', 'PRIMATO', 'CIRRO',
    ];

    // Le sei coppie fondo/banda esistono gia' e sono state scelte per essere
    // leggibili a velocita' di gara: si riusano a rotazione sui venti nomi.
    // Venti non e' multiplo di sei, quindi la rotazione non allinea mai lo
    // stesso colore alla stessa posizione del sacchetto.
    const PANNELLI = NOMI.map(function (nome, k) {
        const tinta = Palette.CITTA_SPONSOR[k % Palette.CITTA_SPONSOR.length];
        return { nome: nome, fondo: tinta.fondo, banda: tinta.banda };
    });

    // L'ordine dei cartelloni lungo il giro: stabile per pista, e mai due
    // uguali di fila.
    //
    // ⚠️ A SACCHETTO, non a caso puro. Pescando a caso, quaranta cartelloni
    // ne mostrerebbero tredici o quattordici diversi: il giocatore vedrebbe
    // gli stessi due o tre nomi tornare a ogni curva, che e' esattamente il
    // «sembra tutto uguale» da cui nasce questo lavoro. Col sacchetto, i
    // primi venti pannelli del giro sono i venti sponsor, ciascuno una volta.
    //
    // ⚠️ E NON BASTA CHE SIANO DIVERSI: devono essere diversi ANCHE DI TINTA.
    // I nomi sono venti e le coppie fondo/banda sei, quindi un vicino su sei
    // avrebbe lo stesso schema di colore — e due cartelloni con lo stesso
    // fondo, uno accanto all'altro, si leggono come un unico pannello lungo
    // con due scritte sopra. Visto in un render dell'atlante: ALTAVIA e
    // KILOVOLT, arancio su antracite tutti e due, senza piu' un confine.
    function sequenza(trackId, quanti) {
        const rng = Seme.mulberry32(Seme.hashString(String(trackId) + ':sponsor'));
        const tintaDi = (k) => k % Palette.CITTA_SPONSOR.length;
        const out = [];
        let sacchetto = [];
        for (let k = 0; k < quanti; k++) {
            if (!sacchetto.length) {
                sacchetto = PANNELLI.map(function (_, i) { return i; });
                for (let i = sacchetto.length - 1; i > 0; i--) {
                    const j = Math.floor(rng() * (i + 1));
                    const t = sacchetto[i]; sacchetto[i] = sacchetto[j]; sacchetto[j] = t;
                }
            }
            // Chi uscirebbe adesso e' in fondo al sacchetto. Se ha la tinta del
            // precedente, si scambia col primo che ce l'ha diversa: verso la
            // fine del sacchetto puo' non essercene nessuno, e allora pazienza
            // — forzarlo vorrebbe dire rompere il giro completo dei venti.
            const ultimo = sacchetto.length - 1;
            if (out.length && tintaDi(sacchetto[ultimo]) === tintaDi(out[out.length - 1])) {
                for (let i = 0; i < ultimo; i++) {
                    if (tintaDi(sacchetto[i]) === tintaDi(out[out.length - 1])) continue;
                    const t = sacchetto[ultimo]; sacchetto[ultimo] = sacchetto[i]; sacchetto[i] = t;
                    break;
                }
            }
            out.push(sacchetto.pop());
        }
        return out;
    }

    return { PANNELLI: PANNELLI, LUNGHEZZA_PANNELLO: LUNGHEZZA_PANNELLO, sequenza: sequenza };
});
