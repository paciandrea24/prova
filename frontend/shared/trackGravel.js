// frontend/shared/trackGravel.js
//
// Profilo delle vie di fuga in ghiaia: per ogni campione della pista e per
// ciascun lato, quante unità di ghiaia ci sono (0 = nessuna). È la SORGENTE
// UNICA da cui derivano il disegno della banda, la posizione delle barriere,
// il muro fisico lato server e la traslazione della scenografia — se questi
// quattro leggessero regole diverse, si vedrebbero barriere disegnate dove il
// muro non c'è (e viceversa).
//
// Dove il profilo vale 0 tutto si comporta ESATTAMENTE come prima che questo
// modulo esistesse: la distanza della barriera è la stessa formula di sempre e
// la scenografia non si sposta. I rettilinei quindi restano identici per
// costruzione, non per una regola scritta a parte.
//
// Rif. docs/superpowers/specs/2026-08-10-f1-vie-di-fuga-ghiaia-design.md
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./trackGeometry.js'));
    else root.TrackGravel = factory(root.TrackGeometry);
})(typeof self !== 'undefined' ? self : this, function (TrackGeometry) {

    // Larghezza della via di fuga: 25 unità ≈ 20 m, poco più di tre lunghezze
    // d'auto (l'auto è 7.17 unità). Misurato sui quattro tracciati reali: in
    // tutte le curve c'è più di 30 unità di spazio libero prima della corsia
    // box, quindi ci sta ovunque serva.
    const GRAVEL_WIDTH = 25;
    // Larghezza del cordolo e distacco della barriera dal suo bordo esterno:
    // ricopiati da f1.js (CURB_W / BARRIER_D), qui perché il profilo deve
    // sapere da dove parte la ghiaia.
    const CURB_W = 2.8;
    const BARRIER_GAP = 1.2;

    // La zona di ghiaia si estende oltre gli estremi della curva per coprire
    // la frenata in ingresso e l'allargata in uscita: è lì che si esce, non a
    // metà curva.
    const CORNER_LEAD = 15;
    // Rampa con cui la larghezza sale da 0 al massimo. Serve a non lasciare
    // gradini nel muro: un'auto che struscia la barriera in uscita di curva
    // ci sbatterebbe contro di spigolo.
    const RAMP = 12;
    // Margine fra il bordo esterno della ghiaia e il bordo della corsia box.
    const PIT_CLEARANCE = 4;
    // Sotto questa larghezza la zona viene scartata del tutto: una linguetta
    // di ghiaia si legge come un errore grafico, non come una via di fuga.
    const MIN_USEFUL_WIDTH = 6;
    // Oltre questa quota il terreno non è più in piano: niente via di fuga su
    // una rampa o un viadotto, come nella realtà. Evita anche di dover
    // allargare il terrapieno, che diventerebbe un piedistallo enorme.
    const FLAT_Y_TOLERANCE = 0.5;
    // Pendenza massima del profilo fra due campioni contigui. Non è una
    // rifinitura estetica: è ciò che impedisce al muro di avere gradini
    // contro cui sbattere di spigolo.
    const MAX_STEP_PER_SAMPLE = 1.0;

    function gravelProfile(trackPts, opts) {
        const n = trackPts.length;
        const { roadHalf, curbW = CURB_W, pitLanePts = null, pitRoadHalf = 0 } = opts;
        const out = { left: new Float64Array(n), right: new Float64Array(n) };
        if (!n) return out;

        const stepLen = TrackGeometry.lapLength(trackPts) / n;
        const leadSamples = Math.max(1, Math.round(CORNER_LEAD / stepLen));
        const rampSamples = Math.max(1, Math.round(RAMP / stepLen));
        const base = roadHalf + curbW + BARRIER_GAP;

        for (const corner of TrackGeometry.findCorners(trackPts)) {
            const banda = corner.side > 0 ? out.right : out.left;
            const arco = (corner.endIdx - corner.startIdx + n) % n;
            const totale = arco + 2 * leadSamples;
            const indiceDi = (s) => (((corner.startIdx - leadSamples + s) % n) + n) % n;

            // Prima passata: larghezza nominale con le rampe agli estremi.
            const larghezze = new Array(totale + 1);
            for (let s = 0; s <= totale; s++) {
                const t = Math.min(1, Math.min(s, totale - s) / rampSamples);
                larghezze[s] = GRAVEL_WIDTH * t;
            }

            // Seconda passata: tagli locali (ponte, quota, corsia box).
            for (let s = 0; s <= totale; s++) {
                const i = indiceDi(s);
                const p = trackPts[i];
                if (p.bridge || Math.abs(p.y || 0) > FLAT_Y_TOLERANCE) {
                    larghezze[s] = 0;
                    continue;
                }
                if (pitLanePts && pitLanePts.length) {
                    const { nx, nz } = TrackGeometry.normalAt(trackPts, i, true);
                    // Quanto ci si può allontanare prima di toccare la corsia
                    // box: si cammina in fuori a passi di 1 unità dal bordo
                    // esterno del cordolo.
                    for (let d = 0; d <= larghezze[s]; d += 1) {
                        const x = p.x + nx * (base + d) * corner.side;
                        const z = p.z + nz * (base + d) * corner.side;
                        if (TrackGeometry.nearestPoint(pitLanePts, x, z).dist < pitRoadHalf + PIT_CLEARANCE) {
                            larghezze[s] = Math.max(0, d - PIT_CLEARANCE);
                            break;
                        }
                    }
                }
            }

            // Una zona troppo stretta (perché tagliata quasi ovunque) si
            // scarta del tutto.
            if (Math.max(...larghezze) < MIN_USEFUL_WIDTH) continue;

            // Terza passata: livellamento anti-gradino. Dopo i tagli la
            // larghezza può crollare di colpo da 25 a 0 (es. all'imbocco di
            // un ponte); si limita la pendenza in entrambi i versi, così il
            // muro resta raccordato.
            for (let s = 1; s <= totale; s++) {
                larghezze[s] = Math.min(larghezze[s], larghezze[s - 1] + MAX_STEP_PER_SAMPLE);
            }
            for (let s = totale - 1; s >= 0; s--) {
                larghezze[s] = Math.min(larghezze[s], larghezze[s + 1] + MAX_STEP_PER_SAMPLE);
            }

            for (let s = 0; s <= totale; s++) {
                // Due curve vicine sullo stesso lato possono sovrapporsi:
                // vince la più larga, mai la somma.
                const i = indiceDi(s);
                if (larghezze[s] > banda[i]) banda[i] = larghezze[s];
            }
        }

        return out;
    }

    function gravelAt(profile, i, side) {
        const banda = side > 0 ? profile.right : profile.left;
        return banda[((i % banda.length) + banda.length) % banda.length];
    }

    function barrierDistAt(profile, i, side, baseDist) {
        return baseDist + gravelAt(profile, i, side);
    }

    return {
        gravelProfile, gravelAt, barrierDistAt,
        GRAVEL_WIDTH, CURB_W, BARRIER_GAP,
        CORNER_LEAD, RAMP, PIT_CLEARANCE, MIN_USEFUL_WIDTH, FLAT_Y_TOLERANCE,
        MAX_STEP_PER_SAMPLE,
    };
});
