// frontend/shared/trackSegmenti.js
//
// Il MODELLO del tracciato come lo disegna l'autore: nodi con una direzione
// e tratti tipizzati. Da qui nascono i `controlPoints` che il gioco legge —
// il gioco non conosce questo file, e non deve.
//
// PERCHÉ ESISTE. Fino al 2026-08-24 il .json conteneva il RISULTATO (dove
// passa la pista) e non l'INTENZIONE (cos'è quel pezzo di pista): da lì
// venivano, tutte insieme, le rette mai dritte, le curve senza raggio e
// l'impossibilità di spostare un rettilineo intero. Un'interfaccia non può
// restituire un'informazione che il dato non contiene.
// Rif. docs/superpowers/specs/2026-08-24-f1-editor-segmenti-design.md
//
// LA TANGENZA NON SI MANTIENE, si eredita: la direzione appartiene al NODO e
// i due tratti che vi si incontrano la leggono dallo stesso posto. Non esiste
// uno stato in cui due tratti adiacenti puntano in direzioni diverse, quindi
// non esistono spigoli — che sarebbero discontinuità di curvatura viste dalla
// fisica e dai bot, non solo brutte da guardare.
//
// Modulo PURO: niente Three.js, niente DOM.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.TrackSegmenti = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    // Un punto ogni 5 unità: fra punti così ravvicinati la Catmull-Rom del
    // gioco non devia dalla forma disegnata (lo misura il test «la forma che
    // il GIOCO vede coincide con quella disegnata»).
    const PASSO_COTTURA = 5;

    // Versore della direzione di un nodo. Convenzione del progetto:
    // dir = atan2(dx, dz), quindi dx = sin(dir) e dz = cos(dir).
    function versore(dir) {
        return { dx: Math.sin(dir || 0), dz: Math.cos(dir || 0) };
    }

    function distanza(a, b) {
        return Math.hypot(b.x - a.x, b.z - a.z);
    }

    // Punti di una Bézier cubica costruita sulle due tangenti: è la curva più
    // semplice che passa per i due nodi rispettando la direzione di entrambi.
    // Le maniglie a un terzo della corda danno la curva più vicina all'arco di
    // cerchio senza casi degeneri.
    //
    // ⚠️ Non ha raggio COSTANTE: la curvatura varia lungo il tratto. Se
    // servisse (validatore, banking), qui dentro si sostituisce un biarco
    // senza toccare il modello — è l'unica funzione da cambiare.
    function valutaCurva(a, b, t) {
        const d = distanza(a, b) / 3;
        const va = versore(a.dir), vb = versore(b.dir);
        const p1 = { x: a.x + va.dx * d, z: a.z + va.dz * d };
        const p2 = { x: b.x - vb.dx * d, z: b.z - vb.dz * d };
        const u = 1 - t;
        const w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
        return {
            x: a.x * w0 + p1.x * w1 + p2.x * w2 + b.x * w3,
            z: a.z * w0 + p1.z * w1 + p2.z * w2 + b.z * w3,
        };
    }

    function valutaTratto(a, b, tratto, t) {
        if (tratto && tratto.tipo === 'retta') {
            return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
        }
        return valutaCurva(a, b, t);
    }

    // Campiona un tratto a passo costante di LUNGHEZZA D'ARCO, non di
    // parametro: su una Bézier il parametro corre più veloce in mezzo alla
    // curva, e campionarlo direttamente darebbe punti fitti agli estremi e
    // radi al centro. Stessa tecnica di TrackGeometry.resample.
    function campionaTratto(a, b, tratto, passo) {
        const FINE = 200;
        const fini = [];
        for (let i = 0; i <= FINE; i++) fini.push(valutaTratto(a, b, tratto, i / FINE));
        const cum = [0];
        for (let i = 1; i < fini.length; i++) cum.push(cum[i - 1] + distanza(fini[i - 1], fini[i]));
        const totale = cum[cum.length - 1];
        const quanti = Math.max(1, Math.round(totale / passo));

        const out = [];
        for (let s = 0; s < quanti; s++) {
            const bersaglio = (s / quanti) * totale;
            let lo = 1;
            while (lo < cum.length - 1 && cum[lo] < bersaglio) lo++;
            const segLen = cum[lo] - cum[lo - 1] || 1e-9;
            const f = (bersaglio - cum[lo - 1]) / segLen;
            const p = fini[lo - 1], q = fini[lo];
            const frazione = totale > 0 ? bersaglio / totale : 0;
            // Quota lineare, e ponte solo fra due nodi che lo sono ENTRAMBI:
            // la stessa regola che TrackGeometry.evalSegment applica già oggi
            // ai punti di controllo, così i punti di transizione (la rampa)
            // restano a terra e il terrapieno continua a coprirli.
            const voce = {
                x: p.x + (q.x - p.x) * f,
                z: p.z + (q.z - p.z) * f,
                y: (a.y || 0) + ((b.y || 0) - (a.y || 0)) * frazione,
            };
            if (a.bridge && b.bridge) voce.bridge = true;
            out.push(voce);
        }
        return out;
    }

    // Geometria -> punti di controllo. Il primo punto di ogni tratto È il suo
    // nodo di partenza; il nodo di arrivo lo mette il tratto successivo, così
    // nessun punto compare due volte e la catena resta chiusa.
    function cuoci(geometria, passo) {
        if (!geometria || !Array.isArray(geometria.nodi) || geometria.nodi.length < 3) {
            throw new Error('Servono almeno 3 nodi');
        }
        const nodi = geometria.nodi;
        const tratti = geometria.tratti || [];
        const step = passo || PASSO_COTTURA;
        const out = [];
        for (let i = 0; i < nodi.length; i++) {
            const a = nodi[i], b = nodi[(i + 1) % nodi.length];
            const punti = campionaTratto(a, b, tratti[i] || { tipo: 'curva' }, step);
            for (const p of punti) out.push(p);
        }
        return out;
    }

    // --- Misure -----------------------------------------------------------
    // I numeri che l'editor mostra e che l'autore riscrive a mano.
    //
    // ⚠️ `raggioMinimo` e non «il raggio»: una Bézier ha curvatura variabile, e
    // il numero che conta a chi guida — e domani al validatore — è il punto
    // più stretto del tratto, non una media che non esiste da nessuna parte.
    function misureTratto(geometria, i) {
        const nodi = geometria.nodi;
        const a = nodi[i], b = nodi[(i + 1) % nodi.length];
        const tratto = (geometria.tratti || [])[i] || { tipo: 'curva' };
        if (tratto.tipo === 'retta') {
            return { lunghezza: distanza(a, b), angolo: 0, raggioMinimo: Infinity };
        }
        const FINE = 100;
        const p = [];
        for (let k = 0; k <= FINE; k++) p.push(valutaTratto(a, b, tratto, k / FINE));
        let lunghezza = 0;
        for (let k = 1; k < p.length; k++) lunghezza += distanza(p[k - 1], p[k]);

        // Raggio del cerchio per tre punti consecutivi: R = (abc) / (4·area).
        let raggioMinimo = Infinity;
        for (let k = 1; k < p.length - 1; k++) {
            const A = p[k - 1], B = p[k], C = p[k + 1];
            const la = distanza(B, C), lb = distanza(A, C), lc = distanza(A, B);
            const areaDoppia = Math.abs((B.x - A.x) * (C.z - A.z) - (C.x - A.x) * (B.z - A.z));
            if (areaDoppia < 1e-9) continue;   // tre punti allineati: raggio infinito
            const R = (la * lb * lc) / (2 * areaDoppia);
            if (R < raggioMinimo) raggioMinimo = R;
        }
        const angolo = Math.atan2(Math.sin(b.dir - a.dir), Math.cos(b.dir - a.dir));
        return { lunghezza, angolo, raggioMinimo };
    }

    // --- Operazioni -------------------------------------------------------
    // Tutte RESTITUISCONO una geometria nuova e non mutano quella ricevuta:
    // è ciò che rende l'annulla dell'editor uno stack di stati invece di una
    // lista di modifiche da saper disfare una per una.
    function copia(geometria) {
        return {
            versione: geometria.versione || 1,
            nodi: geometria.nodi.map(n => Object.assign({}, n)),
            tratti: (geometria.tratti || []).map(t => Object.assign({}, t)),
        };
    }

    const TOLLERANZA_ALLINEAMENTO = 0.001;   // rad

    function scartoAngolare(a, b) {
        return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
    }

    function raddrizza(geometria, i) {
        const g = copia(geometria);
        const n = g.nodi.length;
        const j = (i + 1) % n;
        const dir = Math.atan2(g.nodi[j].x - g.nodi[i].x, g.nodi[j].z - g.nodi[i].z);
        g.nodi[i].dir = dir;
        g.nodi[j].dir = dir;
        g.tratti[i] = { tipo: 'retta' };

        // ⚠️ UN NODO, UNA DIREZIONE. Un tratto retto adiacente che non è più
        // allineato pretenderebbe dal nodo condiviso una direzione diversa da
        // questa: stato che il modello non ammette, quindi cede lui e torna
        // curva. In un circuito vero due rettilinei consecutivi non allineati
        // sono sempre uniti da una curva.
        //
        // Cede il vecchio e non quello appena dichiarato retto: l'ultima
        // intenzione espressa è quella che l'autore sta guardando.
        for (const k of [(i - 1 + n) % n, j]) {
            if (k === i || !g.tratti[k] || g.tratti[k].tipo !== 'retta') continue;
            const da = g.nodi[k], verso = g.nodi[(k + 1) % n];
            const dirAltro = Math.atan2(verso.x - da.x, verso.z - da.z);
            if (scartoAngolare(dirAltro, dir) > TOLLERANZA_ALLINEAMENTO) {
                g.tratti[k] = { tipo: 'curva' };
            }
        }
        return g;
    }

    // Scrivere un numero sposta UN nodo, quello di arrivo: i nodi sono
    // posizioni assolute, non una catena relativa in cui una modifica trascina
    // tutto il resto. È la proprietà che rende il modello adatto a ricalcare
    // un'immagine di riferimento, che è come si disegna una pista vera.
    function impostaLunghezza(geometria, i, lunghezza) {
        const g = copia(geometria);
        const n = g.nodi.length;
        const a = g.nodi[i], b = g.nodi[(i + 1) % n];
        const dir = Math.atan2(b.x - a.x, b.z - a.z);
        const v = versore(dir);
        b.x = a.x + v.dx * lunghezza;
        b.z = a.z + v.dz * lunghezza;
        return g;
    }

    // La direzione che un nodo avrebbe seguendo i vicini: la stessa forma che
    // produce oggi la Catmull-Rom, quindi posare nodi dà il risultato che
    // l'autore si aspetta finché non tocca le maniglie.
    function direzioneAutomatica(geometria, i) {
        const nodi = geometria.nodi, n = nodi.length;
        const prima = nodi[(i - 1 + n) % n], dopo = nodi[(i + 1) % n];
        return Math.atan2(dopo.x - prima.x, dopo.z - prima.z);
    }

    return {
        cuoci, valutaTratto, versore, PASSO_COTTURA,
        misureTratto, raddrizza, impostaLunghezza, direzioneAutomatica,
    };
});
