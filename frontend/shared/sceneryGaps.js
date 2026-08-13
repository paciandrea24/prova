// frontend/shared/sceneryGaps.js
//
// Dove il circuito è VUOTO: tratti di pista che non hanno nessuna struttura
// costruita di fianco.
//
// ⚠️ Questo serve ai TEST, non all'algoritmo di piazzamento, ed è una scelta
// di progetto (spec 2026-08-13-f1-infrastrutture-circuito-design.md). Il
// codice che posa le infrastrutture cammina il giro e mette dove c'è posto;
// è il test a pretendere che alla fine nessun tratto lungo resti spoglio.
// Un'euristica che cerca i buchi e li tappa si adatterebbe in silenzio a
// qualunque cambiamento a monte — per esempio a una diversa densità di
// tribune — nascondendo il problema invece di dichiararlo.
//
// Modulo puro, nessuna dipendenza da Three.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./trackGeometry.js'));
    } else {
        root.SceneryGaps = factory(root.TrackGeometry);
    }
})(typeof self !== 'undefined' ? self : this, function (TrackGeometry) {

    // Che cosa conta come "struttura": roba costruita dall'uomo. Alberi,
    // rocce e laghetti NON contano — un tratto pieno di alberi è comunque un
    // tratto in cui non c'è niente da guardare, ed è esattamente quello che
    // l'utente ha segnalato nei dodici punti M 24-35 del 2026-08-13: in tutti,
    // l'oggetto costruito più vicino stava a 40-60 unità e in mezzo c'erano
    // solo alberi.
    const CATEGORIE_COSTRUITE = ['grandstand', 'grandstand-main', 'paddock',
                                 'landmark', 'paddock-decor', 'paddock-life',
                                 'safety', 'infrastructure'];
    // Quanto lontano dall'asse guardare, e quanto avanti/indietro lungo la
    // pista. Entrambi in unità di gioco, mai in campioni: il campione vale
    // 5.17 unità su `prova` e 1.18 su `monte-rosso`.
    const FASCIA = 90;
    const LUNGO_PISTA = 60;

    function trattiVuoti(trackPts, layout, opzioni) {
        const o = opzioni || {};
        const fascia = o.fascia === undefined ? FASCIA : o.fascia;
        const lungoPista = o.lungoPista === undefined ? LUNGO_PISTA : o.lungoPista;
        const categorie = new Set(o.categorie || CATEGORIE_COSTRUITE);

        const n = trackPts.length;
        const passo = TrackGeometry.lapLength(trackPts) / n;
        const finestra = Math.round(lungoPista / passo);

        // Ogni struttura, ridotta a (campione, lato).
        const strutture = [];
        for (const v of layout) {
            if (!categorie.has(v.category)) continue;
            const q = TrackGeometry.nearestPoint(trackPts, v.x, v.z);
            if (q.dist > fascia) continue;
            const nrm = TrackGeometry.normalAt(trackPts, q.index, true);
            const lato = Math.sign((v.x - trackPts[q.index].x) * nrm.nx +
                                   (v.z - trackPts[q.index].z) * nrm.nz) || 1;
            strutture.push({ idx: q.index, lato });
        }

        const fuori = [];
        for (const lato of [1, -1]) {
            // Marcatura campione per campione: occupato se una struttura del
            // suo lato cade entro la finestra, con wrap sul giro chiuso.
            const occupato = new Array(n).fill(false);
            for (const s of strutture) {
                if (s.lato !== lato) continue;
                for (let d = -finestra; d <= finestra; d++) {
                    occupato[((s.idx + d) % n + n) % n] = true;
                }
            }
            let i = 0;
            while (i < n) {
                if (occupato[i]) { i++; continue; }
                let j = i;
                while (j < n && !occupato[j]) j++;
                let suViadotto = false;
                for (let k = i; k < j; k++) if (trackPts[k].bridge) { suViadotto = true; break; }
                fuori.push({ lato, da: i, a: j - 1, lunghezza: (j - i) * passo, suViadotto });
                i = j;
            }
        }
        return fuori.sort((a, b) => b.lunghezza - a.lunghezza);
    }

    return { trattiVuoti, CATEGORIE_COSTRUITE, FASCIA, LUNGO_PISTA };
});
