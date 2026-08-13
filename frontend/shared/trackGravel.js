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

    // ────────────────────────────────────────────────────────────────────
    // Dove sta la barriera: il profilo che CHIUDE la pista
    //
    // Obiettivo dell'utente: rendere fisicamente impossibile uscire dal
    // circuito, senza però che ogni tracciato diventi Monte Carlo. Il
    // problema non era decidere dove il muro è solido, ma dove SI TROVA: la
    // barriera è sempre stata disegnata a BARRIER_GAP dal bordo del cordolo,
    // cioè mezza lunghezza d'auto, e renderla solida lì darebbe un circuito
    // cittadino ovunque. Quindi la si allontana.
    //
    // Misurato sui tracciati reali prima di scegliere: portare la barriera da
    // 4 a 40 unità oltre il cordolo fa passare i punti in cui non ci starebbe
    // dall'1.7% al 5.0% su prova, e su new-monza non li cambia affatto
    // (4.3% in entrambi i casi). Lo spazio non è il vincolo: lo è solo la
    // corsia box, in una manciata di punti che questo profilo restringe da sé.
    // ────────────────────────────────────────────────────────────────────

    // Distanza del muro oltre il bordo del cordolo dove niente lo costringe
    // altrove: è la posizione "di riposo", quella che il muro tiene sulla
    // stragrande maggioranza del giro.
    //
    // ⚠️ Scelta dall'utente il 2026-08-12 guardando i disegni dall'alto del
    // circuito, non tarata a sensazione. Era 20, e a 20 il muro smetteva di
    // somigliare a un guardrail: nelle curve la ghiaia lo spingeva fino a 25
    // oltre il cordolo, il terreno conteso lo richiamava a 1.2, e le rampe fra
    // i due valori disegnavano lunghe diagonali sul prato — quello che
    // l'utente vedeva in gioco come "grovigli" e "grossi allungamenti".
    // A 16 il muro resta un contorno della pista su tutto il giro.
    const RUNOFF_MIN = 16;
    // ⚠️ Qui NON c'è un RUNOFF_MAX, cioè un tetto fisso oltre il quale il muro
    // non va mai. C'è stato per una sera (2026-08-12) e valeva 16, come
    // RUNOFF_MIN: il muro era di fatto a distanza costante e la gradazione
    // "curva veloce = più ghiaia" spariva quasi del tutto. La regola decisa
    // dall'utente è "16 ovunque tranne nelle curve che in base alla velocità
    // ne necessitano di più", e a limitare il muro basta il tetto geometrico
    // qui sotto, che è locale: stringe dove la curva non regge quella
    // larghezza e lascia stare dove invece ci sta.
    // Quanto deve ancora avanzare il nastro della barriera fra due campioni,
    // in frazione dell'avanzamento della pista. Sotto zero il nastro si
    // ripiega (cuspide), a zero i quad sono degeneri: si pretende una
    // frazione vera. 0.35 è il valore più basso che azzera i ripiegamenti su
    // prova senza stringere il muro dove non serve.
    const BARRIER_MIN_ADVANCE = 0.35;
    // Sui tratti a ponte non c'è terreno attorno: il muro resta a bordo
    // strada, dov'è sempre stato. Stesso valore di
    // CollisionResolver.BRIDGE_BARRIER_MARGIN — è la distanza che il muro
    // fisico dei ponti usa già oggi, non una nuova.
    const BRIDGE_MARGIN = 2;
    // Entro questa distanza dalla pista, la corsia box "corre accanto": è il
    // tratto del traguardo e dei box, che l'utente vuole invariato ("non
    // modificherei troppo nel tratto dei pressi del traguardo e anche dei
    // box, mi piace al momento"). Misurato: la zona così definita va da -284
    // a +377 unità dal traguardo su prova e da -215 a +183 su new-monza, e
    // comprende in entrambi i casi ponte semafori, podio e garage.
    //
    // Una regola sola, che si adatta da sé a un tracciato nuovo disegnato in
    // editor: nessuna finestra in unità attorno all'indice 0 da ritarare.
    const PIT_STRAIGHT_REACH = 80;
    // Di quanto la barriera resta dentro il confine col tratto vicino invece
    // di appoggiarcisi sopra. Sul confine esatto il terreno è ambiguo — è il
    // punto in cui le due mesh si incontrano — e mezza lunghezza d'auto di
    // margine costa niente in una zona dove lo spazio è comunque conteso.
    const BARRIER_NEIGHBOUR_MARGIN = 2;

    // Distanza massima a cui il muro può stare al campione `i` senza che il
    // nastro si ripieghi. Ricavata in forma chiusa dall'avanzamento del punto
    // di barriera, che è lineare nella distanza: A + C*d, con C negativo sul
    // lato interno. Restituisce Infinity sul lato esterno, dove il nastro si
    // allunga e nessun vincolo serve.
    function tettoGeometrico(trackPts, i, side, minAdvance) {
        const n = trackPts.length;
        const prev = (i - 1 + n) % n;
        const t = TrackGeometry.tangentAt(trackPts, prev, true);
        const nQui = TrackGeometry.normalAt(trackPts, i, true);
        const C = side * (nQui.nx * t.tx + nQui.nz * t.tz);
        if (C >= 0) return Infinity;
        const A = (trackPts[i].x - trackPts[prev].x) * t.tx + (trackPts[i].z - trackPts[prev].z) * t.tz;
        return A * (1 - minAdvance) / (-C);
    }

    // Distanza della barriera dall'ASSE pista, campione per campione e lato
    // per lato. Valore assoluto e non un incremento, perché lo consumano tre
    // sistemi diversi (disegno, muro fisico, traslazione della scenografia) e
    // un solo numero non lascia spazio a interpretazioni.
    function barrierProfile(trackPts, opts) {
        const n = trackPts.length;
        const { roadHalf, curbW = CURB_W, pitLanePts = null, pitRoadHalf = 0 } = opts;
        const out = { left: new Float64Array(n), right: new Float64Array(n) };
        if (!n) return out;

        const gravel = gravelProfile(trackPts, opts);
        const bordoCordolo = roadHalf + curbW;
        const storica = bordoCordolo + BARRIER_GAP;   // dov'era prima di tutto questo
        const stepLen = TrackGeometry.lapLength(trackPts) / n;

        // Prima passata: la via di fuga di BASE, cioè quella che spetta al
        // punto a prescindere dalla ghiaia.
        const base = { left: new Float64Array(n), right: new Float64Array(n) };
        // Dove vale la regola del tratto traguardo/box, che tiene tutto com'era
        // prima delle vie di fuga. Segnata qui perché serve anche più sotto:
        // dentro quel tratto la ghiaia non deve spingere fuori il muro.
        const zonaBox = new Array(n).fill(false);
        for (let i = 0; i < n; i++) {
            const p = trackPts[i];
            let d;
            if (p.bridge) {
                d = roadHalf + BRIDGE_MARGIN;
            } else if (pitLanePts && pitLanePts.length
                       && TrackGeometry.nearestPoint(pitLanePts, p.x, p.z).dist < PIT_STRAIGHT_REACH) {
                d = storica;
                zonaBox[i] = true;
            } else {
                d = bordoCordolo + RUNOFF_MIN;
            }
            base.left[i] = d;
            base.right[i] = d;
        }

        // Seconda passata: la ghiaia entra PRIMA del livellamento, non dopo.
        //
        // Il livellamento abbassa soltanto, quindi metterlo per primo
        // sembrerebbe sicuro — non lo è: prendere il massimo con la ghiaia
        // DOPO aver livellato ricrea i gradini appena tolti. Misurato su
        // prova, all'imbocco di un ponte: il muro scendeva a 13 (valore del
        // ponte) mentre la ghiaia in esaurimento lo teneva ancora a 19, per
        // una pendenza di 1.155 contro un limite di 1.0.
        //
        // ⚠️ Sui ponti la ghiaia non partecipa affatto: `bordoCordolo + 0`
        // non è "nessun vincolo", è il bordo del cordolo, e prenderlo come
        // minimo spingerebbe fuori anche il muro dei ponti — che sta più
        // dentro, a roadHalf + BRIDGE_MARGIN.
        //
        // ⚠️ E nemmeno nel tratto del traguardo: lì il muro resta dov'era su
        // ENTRAMBI i lati, anche su quello dove la corsia box non passa.
        // La corsia sta da una parte sola (su prova, 134 campioni protetti su
        // 134 con la corsia a sinistra), ma il tratto va tenuto com'è tutto
        // intero — è la richiesta dell'utente. Lasciando entrare la ghiaia, una
        // curva dentro quel tratto spingeva fuori il muro sul lato libero e poi
        // lo lasciava ricadere: 15 -> 39.6 -> 45.7 -> 29.3 -> 15 -> 33.8 in 200
        // unità di pista, la "fisarmonica" segnalata dall'utente.
        for (let i = 0; i < n; i++) {
            if (trackPts[i].bridge) continue;
            if (zonaBox[i]) {
                // Niente ghiaia dove il muro non arretra: verrebbe rifilata a
                // 1.2 unità, cioè una striscia beige larga un bordino.
                gravel.left[i] = 0;
                gravel.right[i] = 0;
                continue;
            }
            for (const side of [-1, 1]) {
                const larghezza = side > 0 ? gravel.right[i] : gravel.left[i];
                if (larghezza <= 0) continue;
                const banda = side > 0 ? base.right : base.left;
                // La ghiaia spinge fuori il muro quanto la curva chiede: le
                // curve veloci hanno una via di fuga più ampia, quelle lente
                // quasi niente. Non c'è più un tetto fisso — a limitare il
                // muro è il tetto geometrico della passata più sotto, che è
                // locale: dove la curva è troppo stretta perché quella
                // larghezza ci stia, il muro scende da sé.
                //
                // ⚠️ Ma la ghiaia non deve MAI spingere il muro oltre il
                // punto in cui il nastro regge. Su baku le curve hanno raggio
                // 9.9 con pista di semi-larghezza 11: lì nemmeno la distanza
                // storica sta dentro il raggio, e il tetto geometrico non può
                // salvarla perché non scende sotto `storica`. Lasciando
                // spingere la ghiaia i ripiegamenti passavano da 31 a 45,
                // misurato il 2026-08-12. `limite` non scende mai sotto il
                // valore che il campione ha già: la spinta può solo fermarsi,
                // mai peggiorare la situazione di partenza.
                const limite = Math.max(banda[i], tettoGeometrico(trackPts, i, side, BARRIER_MIN_ADVANCE));
                banda[i] = Math.max(banda[i], Math.min(bordoCordolo + larghezza, limite));
            }
        }

        // L'azzeramento appena fatto è netto, e la ghiaia arriva al bordo del
        // tratto protetto ancora larga: si raccorda con la stessa pendenza
        // massima del muro, se no la banda finisce di taglio.
        for (const lato of ['left', 'right']) {
            const g = gravel[lato];
            for (let ripasso = 0; ripasso < 2; ripasso++) {
                for (let i = 0; i < n; i++) g[i] = Math.min(g[i], g[(i - 1 + n) % n] + MAX_SLOPE * stepLen);
                for (let i = n - 1; i >= 0; i--) g[i] = Math.min(g[i], g[(i + 1) % n] + MAX_SLOPE * stepLen);
            }
        }

        // ⚠️ Qui NON c'è una chiusura morfologica che riempie i restringimenti
        // brevi, che pure il piano prevedeva contro la "fisarmonica".
        // Implementata e misurata il 2026-08-12: sui quattro tracciati non
        // cambia un solo campione. Tutti i restringimenti rimasti — 21 unità
        // su prova, 19 e 26 su new-monza — sono imposti dal territorio del
        // tratto vicino, cioè da spazio che davvero non c'è, e la passata
        // successiva li ripristina esattamente com'erano. La fisarmonica vera
        // era una sola, quella del tratto del traguardo, e nasceva dalla
        // ghiaia che entrava in una zona protetta: risolta sopra, alla radice.
        // Se un tracciato nuovo la mostrasse altrove, è qui che va rimessa.

        // Terza passata: la corsia box non va inglobata. Si cammina in fuori
        // dal bordo del cordolo finché non si entra nella sua fascia di
        // rispetto — stessa regola che già limita la ghiaia, così barriera e
        // ghiaia non possono contraddirsi.
        if (pitLanePts && pitLanePts.length) {
            for (let i = 0; i < n; i++) {
                const p = trackPts[i];
                if (p.bridge) continue;
                const { nx, nz } = TrackGeometry.normalAt(trackPts, i, true);
                for (const side of [-1, 1]) {
                    const banda = side > 0 ? base.right : base.left;
                    for (let d = 0; d <= banda[i] - bordoCordolo; d += 1) {
                        const x = p.x + nx * (bordoCordolo + d) * side;
                        const z = p.z + nz * (bordoCordolo + d) * side;
                        if (TrackGeometry.nearestPoint(pitLanePts, x, z).dist < pitRoadHalf + PIT_CLEARANCE) {
                            banda[i] = Math.max(storica, bordoCordolo + d);
                            break;
                        }
                    }
                }
            }
        }

        // Quarta passata: lo spazio conteso con un altro tratto di pista.
        //
        // Dove il tracciato si ripiega su se stesso, dalla mezzeria in poi il
        // terreno appartiene al tratto di fronte, che lo disegna alla PROPRIA
        // quota. Una barriera piazzata di là si ritrova appoggiata su un
        // terreno che non è il suo: se il vicino è più alto ci affonda dentro,
        // se è più basso ci fluttua sopra. Segnalato in gioco dall'utente il
        // 2026-08-12 su prova, dove un ramo a terra corre accanto a uno
        // sopraelevato di 7.3 unità — misurati 23 campioni di barriera sepolta
        // fino a 3.42 unità.
        //
        // Stessa funzione con cui il terrapieno decide dove fermarsi
        // (TrackGeometry.neighbourLimits): se le due divergessero, il muro
        // finirebbe di nuovo su un terreno che non è il suo.
        //
        // ⚠️ I ponti restano fuori: lì la barriera è a bordo strada e sotto
        // non c'è terreno da contendere, c'è l'impalcato.
        let piuLontana = storica;
        for (let i = 0; i < n; i++) {
            piuLontana = Math.max(piuLontana, base.left[i], base.right[i]);
        }
        // Il tetto passato a neighbourLimits è anche il valore che restituisce
        // dove non c'è nessun vicino: va tenuto un margine sopra la barriera
        // più lontana del giro, altrimenti la sottrazione qui sotto
        // arretrerebbe di due unità l'intero tracciato invece dei soli punti
        // contesi.
        const territorio = TrackGeometry.neighbourLimits(trackPts, storica,
            piuLontana + BARRIER_NEIGHBOUR_MARGIN);
        for (let i = 0; i < n; i++) {
            if (trackPts[i].bridge) continue;
            base.right[i] = Math.max(storica, Math.min(base.right[i], territorio.pos[i] - BARRIER_NEIGHBOUR_MARGIN));
            base.left[i] = Math.max(storica, Math.min(base.left[i], territorio.neg[i] - BARRIER_NEIGHBOUR_MARGIN));
        }

        // Quarta passata e tre quarti: niente cuspidi sul lato interno.
        //
        // La barriera è la pista spostata di `d` lungo la normale. Sul lato
        // INTERNO di una curva quello spostamento accorcia il percorso, e
        // oltre il raggio di curvatura lo fa diventare negativo: il nastro
        // indietreggia invece di avanzare, si ripiega e forma prima una
        // cuspide e poi un cappio. È lo stesso motivo per cui non esiste una
        // circonferenza concentrica di raggio negativo — geometria, non
        // taratura: nessun livellamento del profilo può toglierla.
        //
        // Misurato il 2026-08-12: su prova 12 campioni oltre il limite, e le
        // zone annodate (130-137, 333-340, 644-649, 760-768) sono esattamente
        // i quattro punti che l'utente aveva marcato in gioco col tasto M.
        // monte-rosso, l'unico tracciato mai contestato, è l'unico con zero.
        //
        // Il tetto si ricava dalla STESSA formula con cui la mesh piazza i
        // vertici (trackMeshBuilder.js::buildBarriers): l'avanzamento del
        // punto di barriera è lineare in d, quindi la distanza massima che
        // lascia il nastro in avanti si risolve in forma chiusa, senza
        // passare dal raggio di curvatura e dal suo segno — una convenzione
        // in meno da sbagliare.
        //
        // ⚠️ Il tetto va messo sul campione di ARRIVO del segmento, non su
        // quello di partenza: la normale di partenza è per costruzione
        // perpendicolare alla tangente del suo stesso campione, quindi la sua
        // distanza non entra nell'avanzamento. Sbagliato al primo tentativo
        // il 2026-08-12: su prova sembrava funzionare lo stesso (campioni
        // vicini hanno distanze simili), ma su baku restavano 31 ripiegamenti.
        // Non basta pretendere un avanzamento > 0: a filo di zero il nastro
        // avanza di nulla e i quad restano degeneri. Se ne pretende una
        // frazione, che è anche il margine per il campionamento.
        for (let i = 0; i < n; i++) {
            const prev = (i - 1 + n) % n;
            if (trackPts[i].bridge || trackPts[prev].bridge) continue;
            for (const side of [-1, 1]) {
                const tetto = tettoGeometrico(trackPts, i, side, BARRIER_MIN_ADVANCE);
                if (!isFinite(tetto)) continue;   // lato esterno: si allunga, nessun rischio
                const banda = side > 0 ? base.right : base.left;
                const limite = Math.max(storica, tetto);
                if (banda[i] > limite) banda[i] = limite;
            }
        }

        // Quinta passata: livellamento anti-gradino. Il giro è chiuso, quindi
        // due giri per verso servono a propagare il vincolo anche oltre il
        // punto di raccordo dell'indice 0.
        const passoMax = MAX_SLOPE * stepLen;
        for (const lato of ['left', 'right']) {
            const b = base[lato];
            for (let giro = 0; giro < 2; giro++) {
                for (let i = 0; i < n; i++) b[i] = Math.min(b[i], b[(i - 1 + n) % n] + passoMax);
                for (let i = n - 1; i >= 0; i--) b[i] = Math.min(b[i], b[(i + 1) % n] + passoMax);
            }
            out[lato].set(b);
        }

        // Sesta passata: la ghiaia si rifila sul muro. Il livellamento può
        // aver abbassato la barriera sotto la banda disegnata — è quello che
        // succede avvicinandosi a un ponte — e una banda che esce da sotto il
        // muro si vede. Il minimo fra due profili a pendenza limitata resta a
        // pendenza limitata, quindi rifilare non reintroduce gradini.
        //
        // È il motivo per cui la ghiaia rifilata esce da QUI e non da
        // gravelProfile: le due grandezze devono essere decise insieme,
        // altrimenti disegno e muro possono contraddirsi.
        out.gravel = { left: new Float64Array(n), right: new Float64Array(n) };
        for (let i = 0; i < n; i++) {
            out.gravel.left[i] = Math.max(0, Math.min(gravel.left[i], out.left[i] - bordoCordolo));
            out.gravel.right[i] = Math.max(0, Math.min(gravel.right[i], out.right[i] - bordoCordolo));
        }
        return out;
    }

    function barrierAt(profile, i, side) {
        const banda = side > 0 ? profile.right : profile.left;
        return banda[((i % banda.length) + banda.length) % banda.length];
    }

    // Di quanto va spostata verso l'esterno una voce di scenografia calcolata
    // con la barriera storica. La scenografia si dispone a partire dalla
    // barriera, quindi segue il muro: se restasse ferma finirebbe dentro la
    // via di fuga, o murata.
    function sceneryShiftAt(profile, i, side, baseDist) {
        return Math.max(0, barrierAt(profile, i, side) - baseDist);
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
        barrierProfile, barrierAt, sceneryShiftAt,
        RUNOFF_MIN, BARRIER_MIN_ADVANCE, BRIDGE_MARGIN, PIT_STRAIGHT_REACH,
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
