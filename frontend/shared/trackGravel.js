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

    // Larghezza della via di fuga: 32 unità ≈ 25 m, quattro lunghezze d'auto
    // (l'auto è 7.17 unità). Partita da 25 e alzata dopo il primo playtest
    // ("metterei leggermente più ghiaia"). Dove non ci sta — corsia box
    // vicina — il profilo la riduce da sé, non serve tararla per pista.
    const GRAVEL_WIDTH = 32;
    // Larghezza del cordolo e distacco della barriera dal suo bordo esterno:
    // ricopiati da f1.js (CURB_W / BARRIER_D), qui perché il profilo deve
    // sapere da dove parte la ghiaia.
    const CURB_W = 2.8;
    const BARRIER_GAP = 1.2;

    // La zona di ghiaia si estende oltre gli estremi della curva per coprire
    // la frenata in ingresso e l'allargata in uscita: è lì che si esce, non a
    // metà curva.
    const CORNER_LEAD = 15;
    // Lunghezza su cui la larghezza sale da 0 al massimo. Serve a non lasciare
    // gradini nel muro: un'auto che struscia la barriera in uscita di curva
    // ci sbatterebbe contro di spigolo.
    //
    // 32 = GRAVEL_WIDTH, cioè una rampa a 45°. Tarato misurando l'angolo del
    // muro rispetto alla direzione di marcia sui tre tracciati con ghiaia:
    // una rampa da 12 lo portava a 68° (praticamente un muro frontale per chi
    // striscia) guadagnando solo 4-6 unità di larghezza media; scendere a 64
    // addolciva a 27° ma dimezzava la larghezza utile e su monte-rosso la
    // ghiaia non raggiungeva più il massimo in nessuna curva.
    const RAMP = 32;
    // Margine fra il bordo esterno della ghiaia e il bordo della corsia box.
    const PIT_CLEARANCE = 4;
    // Sotto questa larghezza la zona viene scartata del tutto: una linguetta
    // di ghiaia si legge come un errore grafico, non come una via di fuga.
    const MIN_USEFUL_WIDTH = 6;
    // Oltre questa quota il terreno non è più in piano: niente via di fuga su
    // una rampa o un viadotto, come nella realtà. Evita anche di dover
    // allargare il terrapieno, che diventerebbe un piedistallo enorme.
    const FLAT_Y_TOLERANCE = 0.5;
    // Pendenza massima del profilo, in unità di LARGHEZZA per unità di
    // LUNGHEZZA di pista (adimensionale). Non è una rifinitura estetica: è ciò
    // che impedisce al muro di avere gradini contro cui sbattere di spigolo.
    //
    // ⚠️ Va misurata sulla pista, non "per campione": i campioni sono lunghi
    // 1.18 unità su monte-rosso e 5.17 su prova, e una soglia per campione
    // significherebbe due pendenze diverse a seconda della pista. Con 1.0 per
    // campione la ghiaia su "prova" non riusciva a superare le 14 unità di
    // larghezza (misurato in playtest): cresceva di 1 unità ogni 5.17 di
    // pista e una zona di 24 campioni finiva prima di raggiungere il massimo.
    //
    // 1.0 = 45°, la stessa pendenza della rampa nominale (GRAVEL_WIDTH/RAMP):
    // il livellamento interviene solo sui tagli secchi (ponte, quota, corsia
    // box) senza mai strozzare la rampa voluta. Le due costanti vanno tenute
    // coerenti — se cambia una, ricontrollare l'altra.
    const MAX_SLOPE = 1.0;

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
                    // Ci si ferma al primo passo in cui il bordo della ghiaia
                    // entra nella fascia di rispetto della corsia: quel `d` è
                    // già la larghezza massima ammessa, il margine è dentro la
                    // soglia. (Sottrarlo di nuovo qui lo conterebbe due volte
                    // e stringerebbe la ghiaia senza motivo.)
                    for (let d = 0; d <= larghezze[s]; d += 1) {
                        const x = p.x + nx * (base + d) * corner.side;
                        const z = p.z + nz * (base + d) * corner.side;
                        if (TrackGeometry.nearestPoint(pitLanePts, x, z).dist < pitRoadHalf + PIT_CLEARANCE) {
                            larghezze[s] = d;
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
            const passoMax = MAX_SLOPE * stepLen;
            for (let s = 1; s <= totale; s++) {
                larghezze[s] = Math.min(larghezze[s], larghezze[s - 1] + passoMax);
            }
            for (let s = totale - 1; s >= 0; s--) {
                larghezze[s] = Math.min(larghezze[s], larghezze[s + 1] + passoMax);
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

    // Finestra (in unità, non in campioni) attorno ai due estremi della corsia
    // box entro cui barriera e cordolo si aprono. Il varco esisteva già, ma
    // solo nel DISEGNO (era in f1.js): da quando la barriera è anche un muro
    // fisico lato server, la stessa regola deve valere per entrambi — se
    // divergessero, all'ingresso dei box si sbatterebbe contro un muro
    // invisibile dove il disegno mostra un varco.
    //
    // 75 e non l'intera corsia: con l'intera corsia si apriva un varco spurio
    // di 139 unità su "prova", dove la pista passa vicino alla zona box.
    const PIT_MERGE_WINDOW = 75;

    function pitGapSamples(pts) {
        const n = pts.length;
        const cum = [0];
        for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
        const total = cum[n - 1];
        return pts.filter((_, i) => cum[i] < PIT_MERGE_WINDOW || total - cum[i] < PIT_MERGE_WINDOW);
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
        pitGapSamples, PIT_MERGE_WINDOW,
        GRAVEL_WIDTH, CURB_W, BARRIER_GAP,
        CORNER_LEAD, RAMP, PIT_CLEARANCE, MIN_USEFUL_WIDTH, FLAT_Y_TOLERANCE,
        MAX_SLOPE,
    };
});
