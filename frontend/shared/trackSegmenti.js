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

    return { cuoci, valutaTratto, versore, PASSO_COTTURA };
});
