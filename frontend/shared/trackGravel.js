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

    // ────────────────────────────────────────────────────────────────────
    // Quanto si va forte in una curva
    //
    // Le tre costanti qui sotto sono una COPIA di quelle della fisica
    // (backend/sockets/games/physics/): questo modulo è condiviso e il
    // browser lo carica senza il backend, quindi non può richiederle da lì.
    // A tenerle allineate ci pensa un test di guardia,
    // backend/sockets/games/trackGravelPhysics.test.js, che importa entrambe
    // le sorgenti e le confronta: se un giorno la fisica cambia, quel test
    // diventa rosso invece di lasciare la ghiaia tarata su un'auto che non
    // esiste più.
    // ────────────────────────────────────────────────────────────────────
    const MAX_SPEED = 6.2;          // PowertrainModel.MAX_SPEED
    const TURN_SPEED_LOW = 0.075;   // SteeringModel.TURN_SPEED_LOW
    const TURN_SPEED_HIGH = 0.052;  // SteeringModel.TURN_SPEED_HIGH

    // Velocità con cui si percorre una curva di raggio `radius`, in unità per
    // tick. Lo sterzo ha un tasso di rotazione massimo, quindi il raggio
    // percorribile a velocità v è v / tasso: invertendo si ottiene la
    // velocità massima possibile per un raggio dato. È la stessa relazione
    // che usa f1Bot::cornerTargetSpeed per decidere quanto frenare — se le
    // due divergessero, la ghiaia sarebbe dimensionata su una velocità che
    // nessuno tiene davvero.
    //
    // Il tasso dipende a sua volta dalla velocità (interpolato fra LOW e
    // HIGH su v/MAX_SPEED), quindi l'equazione è implicita; qui è risolta in
    // forma chiusa invece che per iterazioni.
    function cornerSpeed(radius) {
        const v = (radius * TURN_SPEED_LOW)
            / (1 - (radius * (TURN_SPEED_HIGH - TURN_SPEED_LOW)) / MAX_SPEED);
        return Math.min(MAX_SPEED, Math.max(0, v));
    }

    // ────────────────────────────────────────────────────────────────────
    // Da quanto si va forte a quanta ghiaia serve
    // ────────────────────────────────────────────────────────────────────

    // Larghezza per una curva percorsa alla velocità massima. Nessuna curva
    // reale ci arriva (a quella velocità non è più una curva), quindi è un
    // fattore di scala e non una larghezza che si vedrà: sui tracciati veri
    // produce 12-32 unità. Il valore è stato validato confrontando le mappe
    // dall'alto di prova e new-monza prima e dopo.
    const GRAVEL_WIDTH_AT_TOP_SPEED = 47;
    // Quanto marcata è la differenza fra curve veloci e lente. 1.5 sta fra il
    // proporzionale alla velocità (1) e il proporzionale all'energia
    // cinetica da dissipare (2, la regola dei circuiti veri): con 2 le curve
    // lente si appiattivano quasi tutte sul minimo, con 1 la differenza non
    // si leggeva.
    const GRAVEL_WIDTH_EXPONENT = 1.5;
    // Sotto questa larghezza la via di fuga non si legge più come tale. In
    // pratica morde solo sui tornanti più lenti (la curva 9 di prova, 136
    // km/h, uscirebbe a 11.8): è una rete di sicurezza, non una manopola di
    // taratura.
    const GRAVEL_WIDTH_MIN = 12;
    // Quota della zona che deve restare a larghezza COSTANTE. Una fascia di
    // ghiaia sale, resta piana, riscende: con metà zona piana le due rampe
    // occupano un quarto ciascuna, cioè il pianoro è lungo quanto le rampe
    // messe insieme.
    //
    // Senza questo vincolo una curva veloce ma corta chiede più larghezza di
    // quanta ne possa aprire e richiudere, e diventa una goccia a punta
    // invece di una via di fuga — difetto segnalato dall'utente sulla curva
    // più veloce di prova, e già presente sulla curva corta di monte-rosso
    // con la larghezza costante di prima. Sui tracciati reali interviene solo
    // sulle tre curve corte e veloci di prova; new-monza non lo attiva mai.
    const MIN_FLAT_FRACTION = 0.5;

    // Larghezza definitiva della via di fuga di una curva: quella che le
    // spetterebbe per la velocità, ridotta se la zona non è lunga abbastanza
    // da contenerla con un pianoro decente. `zoneLength` è la lunghezza in
    // unità di pista dell'intera zona di ghiaia (arco della curva più i due
    // CORNER_LEAD), non del solo arco.
    function cornerGravelWidth(minRadius, zoneLength) {
        const frazione = cornerSpeed(minRadius) / MAX_SPEED;
        const voluta = GRAVEL_WIDTH_AT_TOP_SPEED * Math.pow(frazione, GRAVEL_WIDTH_EXPONENT);
        // Le rampe sono lunghe quanto la larghezza (vedi sotto), quindi
        // pianoro = zona - 2W; imporre pianoro >= zona * MIN_FLAT_FRACTION
        // dà W <= zona * (1 - MIN_FLAT_FRACTION) / 2.
        const consentita = zoneLength * (1 - MIN_FLAT_FRACTION) / 2;
        return Math.max(GRAVEL_WIDTH_MIN, Math.min(voluta, consentita));
    }

    // Larghezza del cordolo e distacco della barriera dal suo bordo esterno:
    // ricopiati da f1.js (CURB_W / BARRIER_D), qui perché il profilo deve
    // sapere da dove parte la ghiaia.
    const CURB_W = 2.8;
    const BARRIER_GAP = 1.2;

    // La zona di ghiaia si estende oltre gli estremi della curva per coprire
    // la frenata in ingresso e l'allargata in uscita: è lì che si esce, non a
    // metà curva.
    const CORNER_LEAD = 15;
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
    // 1.0 = 45°, esattamente la pendenza della rampa nominale: le rampe sono
    // lunghe quanto la larghezza della curva, quindi salgono di 1 unità di
    // larghezza per 1 di pista qualunque sia la larghezza. Il livellamento
    // interviene così solo sui tagli secchi (ponte, quota, corsia box) senza
    // mai strozzare la rampa voluta — se un giorno le rampe si accorciassero
    // rispetto alla larghezza, questo valore andrebbe rialzato di conseguenza.
    //
    // 45° è anche il limite di quanto il muro può stringersi in faccia a chi
    // striscia la barriera: misurato sui tracciati con ghiaia, una rampa da
    // 12 unità portava l'angolo del muro rispetto alla direzione di marcia a
    // 68°, praticamente frontale.
    const MAX_SLOPE = 1.0;

    function gravelProfile(trackPts, opts) {
        const n = trackPts.length;
        const { roadHalf, curbW = CURB_W, pitLanePts = null, pitRoadHalf = 0 } = opts;
        const out = { left: new Float64Array(n), right: new Float64Array(n) };
        if (!n) return out;

        const stepLen = TrackGeometry.lapLength(trackPts) / n;
        const leadSamples = Math.max(1, Math.round(CORNER_LEAD / stepLen));
        const base = roadHalf + curbW + BARRIER_GAP;

        for (const corner of TrackGeometry.findCorners(trackPts)) {
            const banda = corner.side > 0 ? out.right : out.left;
            const arco = (corner.endIdx - corner.startIdx + n) % n;
            const totale = arco + 2 * leadSamples;
            const indiceDi = (s) => (((corner.startIdx - leadSamples + s) % n) + n) % n;

            // Ogni curva ha la SUA larghezza, dalla velocità con cui la si
            // percorre. Le rampe sono lunghe quanto la larghezza (45°): è
            // ciò che rende il pianoro pari a zona - 2W, il conto su cui si
            // regge cornerGravelWidth.
            const larghezza = cornerGravelWidth(corner.minRadius, totale * stepLen);
            const rampSamples = Math.max(1, Math.round(larghezza / stepLen));

            // Prima passata: larghezza nominale con le rampe agli estremi.
            const larghezze = new Array(totale + 1);
            for (let s = 0; s <= totale; s++) {
                const t = Math.min(1, Math.min(s, totale - s) / rampSamples);
                larghezze[s] = larghezza * t;
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
        cornerSpeed, cornerGravelWidth,
        MAX_SPEED, TURN_SPEED_LOW, TURN_SPEED_HIGH,
        GRAVEL_WIDTH_AT_TOP_SPEED, GRAVEL_WIDTH_EXPONENT, GRAVEL_WIDTH_MIN,
        MIN_FLAT_FRACTION,
        CURB_W, BARRIER_GAP,
        CORNER_LEAD, PIT_CLEARANCE, MIN_USEFUL_WIDTH, FLAT_Y_TOLERANCE,
        MAX_SLOPE,
    };
});
