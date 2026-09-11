// frontend/shared/sponsorAtlas.js
//
// I cartelloni pubblicitari a bordo pista: chi sono, di che colore, e in che
// ordine si susseguono lungo il giro.
//
// ⚠️ MARCHI INVENTATI, e nessuno che sia la storpiatura riconoscibile di un
// marchio vero: e' una regola del progetto dal 2026-08-27, e vale anche
// quando la parodia sarebbe divertente.
//
// Modulo puro, nessuna dipendenza da Three: qui si decide COSA e DOVE, il
// disegno lo fa toonStyle e la geometria trackMeshBuilder.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./semeStabile.js'));
    } else {
        root.SponsorAtlas = factory(root.SemeStabile);
    }
})(typeof self !== 'undefined' ? self : this, function (Seme) {

    // Quanto e' lungo un pannello in unita' di gioco. La pista e' larga 22:
    // un cartellone da 12 e' poco piu' di mezza carreggiata, la proporzione
    // dei pannelli veri a bordo pista.
    const LUNGHEZZA_PANNELLO = 12;

    // Quanti cartelloni di fila tiene lo stesso sponsor. Scelta dell'utente
    // (2026-09-11): 4-7 pannelli fanno un'insegna continua lunga 48-84 unita',
    // cioe' due-quattro larghezze di pista. Sotto non si legge come una fila;
    // sopra, sulle piste corte un marchio solo prenderebbe un settore intero.
    const RUN_MIN = 4;
    const RUN_MAX = 7;

    // ⚠️ I COLORI STANNO QUI E NON IN toonPalette. Fino al 2026-09-11 erano sei
    // coppie in `Palette.CITTA_SPONSOR`, riusate a rotazione sui venti nomi:
    // un marchio su sei portava il vestito di un altro. Ma un marchio vero ha i
    // suoi colori e sempre quelli — la tinta e' parte dell'identita' come il
    // nome, non una proprieta' della scena — quindi nome e coppia stanno sulla
    // stessa riga e non possono scollarsi.
    //
    // ⚠️ TINTE DA INSEGNA STAMPATA, non da scenografia. La prima stesura usava
    // colori medi e fondi crema: l'utente li ha bocciati come «troppo pastello
    // e non simili alla realta'». A bordo pista vera le insegne sono a tinte
    // piatte e squillanti — giallo pieno, rosso fuoco, verde bottiglia, blu
    // elettrico — perche' devono leggersi in un decimo di secondo.
    //
    // `famiglia` non e' decorazione: la usa `sequenza` per non attaccare due
    // run di tinta simile, dove il confine sparirebbe. Due sponsor per
    // famiglia, dieci famiglie.
    const PANNELLI = [
        { nome: 'VELOCE',    fondo: 0xFFD100, testo: 0xD1001F, famiglia: 'giallo' },
        { nome: 'AEROTEC',   fondo: 0xE4002B, testo: 0xFFFFFF, famiglia: 'rosso' },
        { nome: 'NOVARIS',   fondo: 0x00623B, testo: 0xF5CE5A, famiglia: 'verde' },
        { nome: 'KILOVOLT',  fondo: 0x1034A6, testo: 0xFFFFFF, famiglia: 'blu' },
        { nome: 'FULMINE',   fondo: 0x008C84, testo: 0xFFFFFF, famiglia: 'turchese' },
        { nome: 'ORBITEC',   fondo: 0xFF6A00, testo: 0x1A1A1A, famiglia: 'arancio' },
        { nome: 'VERTICE',   fondo: 0x15181C, testo: 0xFFD100, famiglia: 'scuro' },
        { nome: 'LAMPO',     fondo: 0xF4F4F2, testo: 0xE4002B, famiglia: 'chiaro' },
        { nome: 'CRONOMAX',  fondo: 0x0057FF, testo: 0xFFE000, famiglia: 'blu' },
        { nome: 'TURBINA',   fondo: 0xA4D600, testo: 0x1B2A00, famiglia: 'verde' },
        { nome: 'ASSOLUTA',  fondo: 0xC4007A, testo: 0xFFFFFF, famiglia: 'magenta' },
        { nome: 'QUADRANTE', fondo: 0x58C4F0, testo: 0x0A2A5E, famiglia: 'turchese' },
        { nome: 'IPERION',   fondo: 0x8A0B2E, testo: 0xF3E3C3, famiglia: 'rosso' },
        { nome: 'MERIDIA',   fondo: 0xFFC400, testo: 0x1A1A1A, famiglia: 'giallo' },
        { nome: 'VOLTARIS',  fondo: 0x5B21B6, testo: 0xFFFFFF, famiglia: 'viola' },
        { nome: 'ALTAVIA',   fondo: 0x009A49, testo: 0xFFFFFF, famiglia: 'verde' },
        { nome: 'BOREALE',   fondo: 0xF04E23, testo: 0xFFFFFF, famiglia: 'arancio' },
        { nome: 'ZEFIRO',    fondo: 0x2B3138, testo: 0xFF8A1E, famiglia: 'scuro' },
        { nome: 'PRIMATO',   fondo: 0x0086CE, testo: 0xFFFFFF, famiglia: 'blu' },
        { nome: 'CIRRO',     fondo: 0xEDEAE2, testo: 0x0B4EA2, famiglia: 'chiaro' },
    ];

    // L'ordine dei cartelloni lungo il giro: stabile per pista, A RUN.
    //
    // ⚠️ SI PESCA UN RUN, NON UN PANNELLO. Fino al 2026-09-11 ogni cartellone
    // aveva il suo sponsor e il marchio cambiava ogni 12 unita'. A bordo pista
    // vero non succede: una fila di tabelloni porta lo stesso marchio per
    // decine di metri, e poi comincia il marchio dopo. Qui un run tiene lo
    // stesso pannello per RUN_MIN..RUN_MAX posti di fila.
    //
    // ⚠️ A SACCHETTO, non a caso puro. Pescando a caso, venti run mostrerebbero
    // tredici o quattordici marchi diversi: il giocatore vedrebbe gli stessi
    // due o tre tornare a ogni curva, che e' esattamente il «sembra tutto
    // uguale» da cui nasce questo lavoro. Col sacchetto, i primi venti run
    // sono i venti sponsor, ciascuno una volta.
    //
    // ⚠️ E AL CONFINE FRA DUE RUN NON BASTA CHE SIANO SPONSOR DIVERSI: devono
    // essere di FAMIGLIA diversa. Dentro il run il fondo e' continuo e i
    // pannelli si fondono in un'insegna sola — che e' lo scopo — ma se anche
    // il run successivo avesse lo stesso rosso, i due si fonderebbero fra loro
    // e il cambio di marchio non si vedrebbe.
    function sequenza(trackId, quanti) {
        const rng = Seme.mulberry32(Seme.hashString(String(trackId) + ':sponsor'));
        const out = [];
        let sacchetto = [];
        let precedente = -1;
        while (out.length < quanti) {
            if (!sacchetto.length) {
                sacchetto = PANNELLI.map(function (_, i) { return i; });
                for (let i = sacchetto.length - 1; i > 0; i--) {
                    const j = Math.floor(rng() * (i + 1));
                    const t = sacchetto[i]; sacchetto[i] = sacchetto[j]; sacchetto[j] = t;
                }
            }
            // Chi uscirebbe adesso e' in fondo al sacchetto. Se e' della
            // famiglia del run precedente si scambia col primo che ce l'ha
            // diversa: verso la fine del sacchetto puo' non essercene nessuno,
            // e allora pazienza — forzarlo vorrebbe dire rompere il giro
            // completo dei venti.
            const ultimo = sacchetto.length - 1;
            if (precedente >= 0
                && PANNELLI[sacchetto[ultimo]].famiglia === PANNELLI[precedente].famiglia) {
                for (let i = 0; i < ultimo; i++) {
                    if (PANNELLI[sacchetto[i]].famiglia === PANNELLI[precedente].famiglia) continue;
                    const t = sacchetto[ultimo]; sacchetto[ultimo] = sacchetto[i]; sacchetto[i] = t;
                    break;
                }
            }
            const scelto = sacchetto.pop();
            const lungo = RUN_MIN + Math.floor(rng() * (RUN_MAX - RUN_MIN + 1));
            for (let i = 0; i < lungo && out.length < quanti; i++) out.push(scelto);
            precedente = scelto;
        }
        return out;
    }

    return {
        PANNELLI: PANNELLI,
        LUNGHEZZA_PANNELLO: LUNGHEZZA_PANNELLO,
        RUN_MIN: RUN_MIN,
        RUN_MAX: RUN_MAX,
        sequenza: sequenza,
    };
});
