// frontend/shared/sceneryMarciapiede.js
//
// L'ARREDO URBANO FRA LA BARRIERA E I PALAZZI.
//
// In un circuito cittadino, fra il muro e la prima facciata restano una
// ventina di unità di asfalto: è la strada, e in una città vera non è mai
// vuota. Qui ci vanno lampioni, semafori, fermate, edicole, cassonetti e
// tavolini — i modelli sono in `backend/tools/circuitAssets/cittaStrada.py`.
// Rif. docs/superpowers/specs/2026-08-27-f1-citta-g2-design.md
//
// ⚠️ QUESTA ROBA STA A BORDO PISTA, NON SULLA FACCIATA. Si posa a partire dal
// MURO — come le tribune, come le pile di gomme — e non dal profilo della
// città: è di qua dalle facciate, e deve restare davanti a loro. Chi si appoggia
// ai palazzi (edicole, fermate) lo fa misurando all'indietro dalla facciata, ma
// il vincolo che conta è sempre lo stesso: mai dentro il muro, mai dentro un
// palazzo.
//
// Ogni voce passa poi dalla PORTA della scenografia come tutte le altre, quindi
// ciò che non ci sta viene scartato invece di compenetrare qualcosa.
//
// Modulo puro: niente Three.js, niente DOM.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./trackGeometry.js'), require('./trackGravel.js'),
                                 require('./semeStabile.js'));
    } else {
        root.SceneryMarciapiede = factory(root.TrackGeometry, root.TrackGravel, root.SemeStabile);
    }
})(typeof self !== 'undefined' ? self : this, function (TrackGeometry, TrackGravel, SemeStabile) {

    const CATEGORIA = 'strada';

    // Quanto sta lontano dal muro chi si affaccia sulla strada, e quanto dalla
    // facciata chi ci si appoggia. Sono le due sponde del marciapiede.
    const DAL_MURO = 4.0;
    // ⚠️ 6.5 e non 3: la facciata non e' un piano, e' una lastra spessa tre
    // unita' che cresce VERSO la pista, e l'oggetto ha una sua profondita' che
    // conta da meta' in poi — e in curva l'oggetto e' anche ruotato rispetto
    // alla colonna che ha davanti. Con 3.2 il dehors entrava di 2.29 dentro il
    // muro del palazzo, con 5.5 di 1.03.
    const DAL_PALAZZO = 6.5;

    // Il passo di ciascun tipo, in unità di percorso. I lampioni sono l'unico
    // arredo REGOLARE — in una strada lo sono davvero, e la loro fila è ciò che
    // dice «questa è una via» anche a 250 km/h. Tutto il resto è raro e
    // sparso: se ricorresse con lo stesso passo si leggerebbe come un motivo.
    const PASSI = {
        cittaLampione:   52,
        cittaSemaforo:   190,
        cittaCassonetti: 230,
        cittaDehors:     310,
        cittaEdicola:    360,
        cittaFermata:    430,
    };
    // Chi si appoggia ai palazzi invece di stare sul bordo della strada.
    const AL_PALAZZO = new Set(['cittaFermata', 'cittaEdicola', 'cittaDehors', 'cittaCassonetti']);

    // Le auto parcheggiate in linea: gruppi di tre o quattro, non una fila
    // infinita — un parcheggio continuo lungo tutto il circuito è irreale
    // quanto uno vuoto.
    const AUTO = ['parkedCarRed', 'parkedCarBlue', 'parkedCarWhite'];
    const AUTO_PASSO = 275;      // fra un gruppo e il successivo
    const AUTO_LUNGHEZZA = 6.6;  // fra un'auto e la prossima, dentro il gruppo

    // Distanza minima dalla corsia box: la strada finisce dove comincia il
    // recinto del circuito, e un'edicola in mezzo alla pit lane non è un
    // difetto estetico, è un oggetto dentro un'area di gara.
    const DA_CORSIA_BOX = 40;

    function buildLayout(trackPts, profilo, barrierProfile, pitPts, trackId) {
        const voci = [];
        const n = trackPts && trackPts.length;
        if (!n || !profilo || !profilo.distanza) return voci;

        const lapLen = TrackGeometry.lapLength(trackPts);
        const passoCampione = lapLen / n;
        const rng = SemeStabile.mulberry32(SemeStabile.hashString((trackId || '') + ':strada'));

        // Un giro per tipo: così ogni arredo ha il suo passo e i suoi due lati,
        // e l'ordine in cui entrano nella porta è stabile.
        for (const asset of Object.keys(PASSI)) {
            const ogni = Math.max(1, Math.round(PASSI[asset] / passoCampione));
            // Sfasatura per tipo: senza, lampione, semaforo ed edicola
            // cadrebbero tutti sullo stesso campione ogni volta che i passi si
            // incontrano, e lì sarebbero uno dentro l'altro.
            const sfasa = Math.floor(rng() * ogni);
            for (let i = sfasa; i < n; i += ogni) {
                // I lampioni stanno su tutti e due i lati; il resto si alterna,
                // o la strada sembrerebbe arredata da un catalogo.
                const lati = asset === 'cittaLampione' ? [1, -1]
                    : [Math.floor(i / ogni) % 2 === 0 ? 1 : -1];
                for (const side of lati) {
                    const voce = posa(asset, trackPts, profilo, barrierProfile, pitPts, i, side);
                    if (voce) voci.push(voce);
                }
            }
        }

        // Le auto in linea, a gruppi.
        const ogniAuto = Math.max(1, Math.round(AUTO_PASSO / passoCampione));
        const passoAuto = Math.max(1, Math.round(AUTO_LUNGHEZZA / passoCampione));
        for (let i = 0; i < n; i += ogniAuto) {
            const side = Math.floor(i / ogniAuto) % 2 === 0 ? -1 : 1;
            const quante = 3 + Math.floor(rng() * 2);
            for (let a = 0; a < quante; a++) {
                const j = (i + a * passoAuto) % n;
                const voce = posa(AUTO[(a + i) % AUTO.length], trackPts, profilo,
                                  barrierProfile, pitPts, j, side, true);
                if (voce) voci.push(voce);
            }
        }
        return voci;
    }

    // Una voce, se in quel punto il marciapiede c'è ed è abbastanza largo.
    function posa(asset, trackPts, profilo, barrierProfile, pitPts, i, side, inLinea) {
        const p = trackPts[i];
        if (p.bridge || p.acrobatico) return null;
        // Sotto un giro della morte o su un ponte non c'è marciapiede, e nella
        // zona dei box c'è il recinto del circuito.
        if (pitPts && pitPts.length
            && TrackGeometry.nearestPoint(pitPts, p.x, p.z).dist < DA_CORSIA_BOX) return null;

        const k = i * 2 + (side > 0 ? 0 : 1);
        const muro = TrackGravel.barrierAt(barrierProfile, i, side);
        const facciata = profilo.distanza[k];
        const largo = facciata - muro;
        // Dove la città arretra per il paddock il marciapiede diventa un
        // piazzale: lì l'arredo da strada non c'entra niente.
        if (largo < 12 || largo > 40) return null;

        const d = AL_PALAZZO.has(asset) ? facciata - DAL_PALAZZO : muro + DAL_MURO;
        const nrm = TrackGeometry.normalAt(trackPts, i, true);
        const x = p.x + nrm.nx * d * side;
        const z = p.z + nrm.nz * d * side;
        // Chi guarda la strada è orientato come le facciate — verso la pista.
        // Le auto in linea no: quelle stanno parallele al marciapiede.
        const versoLaPista = Math.atan2(-nrm.nx * side, -nrm.nz * side);
        const t = TrackGeometry.tangentAt(trackPts, i, true);
        return {
            asset, category: CATEGORIA,
            x, y: p.y || 0, z,
            rotY: inLinea ? Math.atan2(t.tx, t.tz) : versoLaPista,
            scale: 1,
        };
    }

    return { buildLayout, CATEGORIA, PASSI, DAL_MURO, DAL_PALAZZO };
});
