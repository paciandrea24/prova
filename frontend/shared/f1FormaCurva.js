// frontend/shared/f1FormaCurva.js
//
// LARGO, STRETTO ALL'APICE, LARGO — la forma che la racing line ottimizzata
// non ha.
//
// ⚠️ NASCE DA UNA MISURA E DA UN PLAYTEST. L'utente, 2026-09-06: «le macchine
// seguono la racing line che e' sempre e solo interna, e quindi anche se le
// macchine si spostano per difendere, comunque lo spazio e' tantissimo».
// Misurato su `prova`, col segno dell'interno curva positivo: ingresso +4.84,
// apice +7.98, uscita +4.16 di media, e 10 curve su 13 percorse SEMPRE
// dall'interno — la curva 1 entra a 10.72 su una mezza carreggiata di 11,
// cioe' incollata al cordolo prima ancora di girare. Il difetto era gia'
// documentato dal 2026-07-29 sulla linea di New Monza, mai affrontato.
//
// La causa sta a monte, nell'ottimizzatore: valuta la velocita' di curva sulla
// curvatura DELLA LINEA e non premia mai il raggio guadagnato allargandosi,
// quindi taglia sempre corto. Correggerlo li' vuol dire rigenerare tutte le
// piste e ritarare il passo dei bot; qui si rimette la forma DOPO, sugli
// offset, con una manopola sola e reversibile.
//
// ⚠️ NON E' `botAllargamento`. Quello sposta il BERSAGLIO lasciando la linea
// dov'e': il bot paga la strada in piu' senza incassare il raggio, ed e' il
// motivo per cui costa 650 ms. Qui si sposta la LINEA, e `cornerTargetSpeed`
// legge la curvatura di quella (f1Bot.js) — un apice piu' dolce lo fa andare
// piu' forte, non piu' piano.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(
        typeof require === 'function' ? require('./trackGeometry.js') : root.TrackGeometry);
    else root.F1FormaCurva = factory(root.TrackGeometry);
})(typeof self !== 'undefined' ? self : this, function (TrackGeometry) {

    // Quanto prima e quanto dopo la curva si sta larghi, IN UNITA' DI PISTA e
    // non in campioni: un campione vale 1.18 unita' su monte-rosso e 5.17 su
    // `prova`, e in campioni la stessa cifra darebbe quattro comportamenti
    // diversi in silenzio.
    const ZONA_M = 70;
    // Quanto margine lasciare fra la linea e il bordo: mezza auto piu' un
    // filo, cosi' stare larghi non vuol dire mettere due ruote in ghiaia.
    const MARGINE_BORDO = 2.2;

    // Quanto la linea puo' spostarsi DI TRAVERSO per ogni unita' percorsa.
    // ⚠️ E' un vincolo fisico, non estetico: un'auto non trasla di lato. Senza,
    // una curva corta chiede l'impossibile — misurato su `prova`, la curva
    // 98-109 e' lunga 11 campioni contro i 13 della zona di allargamento, e la
    // forma le faceva attraversare 19 unita' di pista in mezzo secondo, con
    // salti di 4.16 unita' fra due campioni. Il valore sta appena sopra la
    // pendenza che la linea ottimizzata ha gia' per conto suo (0.37).
    const PENDENZA_MAX = 0.40;

    // Da 0 a 1 con derivata nulla ai due capi: senza, la giunzione fra il
    // tratto allargato e il resto e' uno scalino, e uno scalino nell'offset e'
    // una sterzata a scatto.
    function raccordo(t) {
        const x = Math.max(0, Math.min(1, t));
        return x * x * (3 - 2 * x);
    }

    // Taglia le pendenze eccessive senza mai stringere piu' di quanto la linea
    // di partenza gia' facesse: `limiti[i]` non scende mai sotto il salto che
    // l'originale ha in quel punto, cosi' la linea ottimizzata resta sempre
    // una soluzione ammissibile e il limitatore non la erode.
    //
    // Avanti e indietro, e piu' volte: su un tracciato CHIUSO una passata sola
    // lascerebbe il residuo a cavallo dell'indice zero, e correggere in un
    // verso solo sposterebbe tutta la linea in avanti.
    function limitaPendenza(valori, limiti) {
        const n = valori.length;
        const out = valori.slice();
        for (let giro = 0; giro < 3; giro++) {
            for (let k = 0; k < n; k++) {
                const i = k % n, j = (k + 1) % n;
                const d = out[j] - out[i];
                if (Math.abs(d) > limiti[i]) out[j] = out[i] + Math.sign(d) * limiti[i];
            }
            for (let k = n - 1; k >= 0; k--) {
                const i = (k + 1) % n, j = k % n;
                const d = out[j] - out[i];
                if (Math.abs(d) > limiti[j]) out[j] = out[i] + Math.sign(d) * limiti[j];
            }
        }
        return out;
    }

    // L'offset firmato della racing line rispetto all'asse, campione per
    // campione. E' la forma in cui la linea viene salvata e ricostruita
    // (trackLoader.buildRacingLineFromControls), ed e' quella su cui conviene
    // lavorare: sui punti servirebbe rifare le normali a ogni passo.
    function offsetDellaLinea(points, racingLine) {
        return points.map((pt, i) => {
            const nrm = TrackGeometry.normalAt(points, i, true);
            return (racingLine[i].x - pt.x) * nrm.nx + (racingLine[i].z - pt.z) * nrm.nz;
        });
    }

    function lineaDaOffset(points, offsets) {
        return points.map((pt, i) => {
            const nrm = TrackGeometry.normalAt(points, i, true);
            return { x: pt.x + nrm.nx * offsets[i], z: pt.z + nrm.nz * offsets[i] };
        });
    }

    // `ampiezza` e' la manopola: frazione della mezza carreggiata di cui ci si
    // allarga verso l'esterno, prima e dopo l'apice. 0 = la linea di prima.
    function allargaIngressoUscita(points, offsets, roadHalf, ampiezza, opzioni) {
        const o = opzioni || {};
        const zonaM = o.zonaM || ZONA_M;
        const pendenzaMax = o.pendenzaMax || PENDENZA_MAX;
        const n = points.length;
        if (!ampiezza) return offsets.slice();
        const corners = TrackGeometry.findCorners(points);
        if (!corners.length) return offsets.slice();
        const passo = TrackGeometry.lapLength(points) / n;
        const zona = Math.max(1, Math.round(zonaM / passo));

        // ⚠️ SI MIRA A UNA POSIZIONE, NON SI SOMMA UNO SPOSTAMENTO. Sommare
        // un allargamento all'offset esistente non garantisce niente: dove la
        // linea entra gia' a 10.72 su 11, aggiungerne 7.7 la lascia ancora
        // interna, e il tetto che la trattiene in pista finirebbe per
        // schiacciare anche l'apice, che invece e' l'unica cosa che la linea
        // ottimizzata azzecca. Interpolando verso un bersaglio si ottiene la
        // forma voluta da qualunque punto si parta.
        //
        // Peso e bersaglio si accumulano come MEDIA PESATA, non a chi vince:
        // due curve che si accavallano hanno bersagli opposti in una chicane,
        // e prendere il maggiore fa saltare l'offset da +7 a -7 fra due
        // campioni — misurato, 13.18 unita' di scalino, cioe' una sterzata a
        // scatto. La media pesata resta continua.
        const sommaPeso = new Array(n).fill(0);
        const sommaMirato = new Array(n).fill(0);
        for (const c of corners) {
            const len = ((c.endIdx - c.startIdx) % n + n) % n;
            // L'apice vero e' il raggio minimo, non la meta' dell'arco: su una
            // curva fusa il punto medio cade sul tratto quasi dritto in mezzo.
            let iApice = c.startIdx, rMin = Infinity, kApice = 0;
            for (let k = 0; k <= len; k++) {
                const { radius } = TrackGeometry.curvatureAt(points, (c.startIdx + k) % n);
                if (radius < rMin) { rMin = radius; iApice = (c.startIdx + k) % n; kApice = k; }
            }
            // Verso l'esterno: `side` di findCorners E' gia' il lato esterno.
            // Il bersaglio e' il bordo della carreggiata meno il margine: e'
            // li' che passa chi entra largo davvero.
            const bersaglio = (c.side || 1) * Math.max(0, roadHalf - MARGINE_BORDO);

            // Il profilo, in quattro tratti. ⚠️ Il massimo cade all'INIZIO e
            // alla FINE della curva, non fuori: e' li' che un pilota e' largo,
            // e da li' stringe verso l'apice. Le due code sui rettilinei
            // servono solo a raccordare — un peso che parte gia' pieno al
            // bordo della zona e' uno scalino, ed e' quello che mandava
            // l'offset da 0 a 7 unita' fra due campioni.
            // Il peso di un lato: sale da zero al bordo della zona, vale UNO
            // al confine della curva, torna a zero sull'apice. Scritto come
            // minimo delle due rampe invece che a tratti, cosi' non ha casi
            // degeneri: se l'apice cade sull'inizio curva (`dentro` = 0) la
            // seconda rampa e' piatta a zero e tutto il lato si spegne da
            // solo, invece di lasciare uno scalino dove i tratti si toccano.
            // Misurato: a tratti restava un salto di 4.16 unita' fra due
            // campioni, che e' una sterzata a scatto.
            const lato = (partenza, dentro, verso) => {
                const totale = zona + dentro;
                // ⚠️ QUANTO CI SI PUO' ALLARGARE LO DECIDE LO SPAZIO, non la
                // manopola. In una curva corta non c'e' modo di stare larghi
                // E prendere l'apice: qualcosa deve cedere, e non puo' essere
                // l'apice — e' l'unica cosa che la linea ottimizzata azzecca
                // (misurato: senza questo, sulla curva 98-109 di `prova`
                // l'apice si spostava da 10.60 a 8.35). Cede l'allargamento,
                // che qui si riduce a quello che ci sta.
                const partenzaApice = offsets[iApice];
                const salto = bersaglio - partenzaApice;
                // ⚠️ Lo spazio utile e' il TRATTO RIPIDO, non tutto il lato:
                // fra l'apice e il confine della curva il peso fa gia' tutto
                // il suo viaggio da 0 a 1, e su `prova` sono 5 campioni contro
                // i 18 del lato intero. Il 1.5 e' il picco di pendenza del
                // raccordo rispetto alla sua media — uno smoothstep sale una
                // volta e mezza piu' ripido di una rampa dritta.
                const ripido = Math.min(zona, dentro || zona);
                const possibile = ripido * passo * pendenzaMax / 1.5;
                const mira = partenzaApice + Math.sign(salto) * Math.min(Math.abs(salto), possibile);
                for (let k = 0; k <= totale; k++) {
                    const i = (((partenza + verso * k) % n) + n) % n;
                    const salita = raccordo(k / zona);
                    const discesa = dentro ? raccordo((totale - k) / dentro) : 0;
                    const w = Math.min(salita, discesa);
                    sommaPeso[i] += w; sommaMirato[i] += w * mira;
                }
            };
            // Ingresso: dal rettilineo prima della curva fino all'apice.
            lato(((c.startIdx - zona) % n + n) % n, kApice, 1);
            // Uscita: dal rettilineo dopo la curva all'indietro, fino all'apice.
            lato((c.endIdx + zona) % n, len - kApice, -1);
        }

        const voluti = offsets.map((o, i) => {
            if (!sommaPeso[i]) return o;
            const peso = Math.min(1, sommaPeso[i]) * ampiezza;
            const mirato = sommaMirato[i] / sommaPeso[i];
            return o * (1 - peso) + mirato * peso;
        });
        const limiti = offsets.map((o, i) =>
            Math.max(pendenzaMax * passo, Math.abs(offsets[(i + 1) % n] - o)));
        return limitaPendenza(voluti, limiti);
    }

    return { offsetDellaLinea, lineaDaOffset, allargaIngressoUscita, ZONA_M, MARGINE_BORDO };
});
