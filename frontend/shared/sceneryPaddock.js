// frontend/shared/sceneryPaddock.js
//
// Piazzamento del paddock: motorhome, camion, container, parcheggi e
// striscioni davanti alle tribune.
//
// Vive in un modulo suo perché ha un CRITERIO proprio, diverso dallo scatter
// casuale della natura: qui gli oggetti stanno in file allineate lungo la
// corsia box, come in un paddock vero. È la stessa ragione per cui esistono
// già sceneryLandmarks (uno per tracciato, ancorati al traguardo) e
// sceneryTrackside (distribuiti secondo la curvatura).
//
// Modulo puro: nessuna dipendenza da Three.js.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./trackGeometry.js'), require('./sceneryAssetSizes.js'));
    } else {
        root.SceneryPaddock = factory(root.TrackGeometry, root.SceneryAssetSizes);
    }
})(typeof self !== 'undefined' ? self : this, function (TrackGeometry, SceneryAssetSizes) {

    // Distanza della fila principale dall'asse della corsia box, dalla parte
    // OPPOSTA alla pista: il paddock sta dietro i garage, non davanti.
    //
    // 40 e non 74: a quella distanza motorhome e camion erano invisibili
    // (segnalato dall'utente al playtest) — un mezzo lungo 15 unità a 74
    // dall'asse della corsia è più lontano di una tribuna e si perde nel
    // prato. A 40 sta appena dietro i garage, che è dove sta in un paddock
    // vero e dove il giocatore lo vede a ogni pit stop.
    const ROW_OFFSET = 58;
    // Passo fra i mezzi: l'ingombro maggiore è il camion (19.1) più respiro.
    const ROW_STEP = 23;
    const ROW_MAX = 9;
    // Seconda fila, più arretrata: container e parcheggi.
    const BACK_OFFSET = 86;
    const MEZZI_COUNT = 7;
    const PARK_OFFSET = 210;   // lontano: il parcheggio fa orizzonte, non ingombro
    const PARK_ROWS = 4;
    const PARK_COLS = 9;
    const PARK_STEP_X = 3.2;    // auto affiancate, larghe 2.2
    const PARK_STEP_Z = 7.0;    // corsia di manovra fra due file
    // Striscioni: solo DIETRO LE TRIBUNE, non sparsi lungo il giro.
    //
    // La prima versione li metteva a passo fisso lungo tutto il tracciato, e
    // il risultato era esattamente quello che l'utente ha visto: cartelli
    // piantati a caso, uno perfino dentro la corsia box. Uno striscione ha
    // senso dove c'è pubblico che lo guarda — cioè davanti alle tribune — e
    // in nessun altro posto.
    const BANNER_OFFSET = 6;    // oltre barrierDist, come i cartelloni sponsor
    const BANNER_STEP = 170;    // unita di percorso fra uno e il successivo
    // Distanza minima dalla corsia box: un cartello in mezzo alla pit lane non
    // è un difetto estetico, è un oggetto dentro un'area di gara.
    const PIT_CLEARANCE = 30;

    const CAR_COLORS = ['parkedCarRed', 'parkedCarBlue', 'parkedCarWhite'];

    // Da che parte sta la pista rispetto alla corsia box: il paddock va
    // dall'altra. Si guarda il punto medio della corsia e si confronta la
    // distanza dalla pista dei due lati.
    function latoOpposto(pitPts, trackPts, idx) {
        const p = pitPts[idx];
        const { nx, nz } = TrackGeometry.normalAt(pitPts, idx, false);
        const a = TrackGeometry.nearestPoint(trackPts, p.x + nx * 30, p.z + nz * 30).dist;
        const b = TrackGeometry.nearestPoint(trackPts, p.x - nx * 30, p.z - nz * 30).dist;
        return a > b ? 1 : -1;
    }

    // A che distanza dalla corsia box mettere l'area logistica. Si prova la
    // distanza voluta e si scende finche' TUTTO il blocco — mezzi davanti,
    // quattro file di auto, container in fondo — resta lontano dalla pista.
    // La misura e' sui punti estremi del blocco lungo la normale: e' li' che
    // il blocco si avvicina o si allontana, mentre lo sviluppo laterale resta
    // dov'e'.
    const PARK_MIN_OFFSET = 80;       // sotto, il parcheggio e' addosso ai box
    const PARK_TRACK_CLEARANCE = 25;  // oltre il muro: il parcheggio non e' scenografia di bordo pista
    function scegliOffset(trackPts, pPark, nPark, side, barrierDist) {
        const soglia = (barrierDist || 15) + PARK_TRACK_CLEARANCE;
        let migliore = PARK_OFFSET, migliorDist = -Infinity;
        for (let off = PARK_OFFSET; off >= PARK_MIN_OFFSET; off -= 10) {
            let peggio = Infinity;
            // dal muso dei mezzi alla schiena dei container
            for (const d of [off - 34, off, off + (PARK_ROWS - 1) * PARK_STEP_Z,
                             off + PARK_ROWS * PARK_STEP_Z + 14]) {
                const x = pPark.x + nPark.nx * side * d;
                const z = pPark.z + nPark.nz * side * d;
                const dist = TrackGeometry.nearestPoint(trackPts, x, z).dist;
                if (dist < peggio) peggio = dist;
            }
            if (peggio >= soglia) return off;
            if (peggio > migliorDist) { migliorDist = peggio; migliore = off; }
        }
        // Nessuna distanza va bene: si prende la meno peggio invece di
        // insistere su quella voluta. La porta scartera' cio' che comunque
        // non ci sta, ma almeno non ci prova dal punto peggiore.
        return migliore;
    }

    function buildLayout(rng, trackPts, pitPts, barrierDist, accepted, vietato) {
        const layout = [];
        if (!pitPts || pitPts.length < 8) return layout;

        const mid = Math.floor(pitPts.length / 2);
        const side = latoOpposto(pitPts, trackPts, mid);
        const stepLen = Math.max(1e-3,
            Math.hypot(pitPts[1].x - pitPts[0].x, pitPts[1].z - pitPts[0].z));
        const passo = Math.max(1, Math.round(ROW_STEP / stepLen));

        function piazza(asset, x, z, rotY, category) {
            const voce = { asset, category, x, y: 0, z, rotY, scale: 1 };
            // La zona dei box del giocatore è off limits: ci si ferma per il
            // pit stop e ci si manovra. Avvicinando la fila del paddock da 74 a
            // 40 un motorhome ci è finito dentro — il controllo mancava.
            if (vietato && vietato(voce)) return null;
            for (const altro of accepted) {
                if (SceneryAssetSizes.itemsOverlap(voce, altro)) return null;
            }
            for (const altro of layout) {
                if (SceneryAssetSizes.itemsOverlap(voce, altro)) return null;
            }
            layout.push(voce);
            accepted.push(voce);
            return voce;
        }

        // --- Parcheggio lontano -------------------------------------------
        // Le auto sparse vicino ai box si leggevano come relitti abbandonati:
        // un parcheggio e' fatto di file ordinate e sta LONTANO, dove diventa
        // parte dell'orizzonte invece di intralciare. I container gli fanno da
        // fondale sul lato esterno.
        const idxPark = mid;
        const pPark = pitPts[idxPark];
        const nPark = TrackGeometry.normalAt(pitPts, idxPark, false);
        const tangPark = Math.atan2(pitPts[idxPark + 1].x - pitPts[idxPark - 1].x,
                                    pitPts[idxPark + 1].z - pitPts[idxPark - 1].z);
        const lx = Math.sin(tangPark), lz = Math.cos(tangPark);

        // QUANTO LONTANO, lo decide la pista. Proiettare 210 unita' in linea
        // retta «dalla parte opposta» funziona finche' il circuito e' largo:
        // su uno compatto quella retta attraversa l'infield ed esce
        // dall'altra parte del tracciato. Su monte-rosso il parcheggio
        // atterrava a 37 unita' dall'asse e i suoi container finivano dentro
        // la pista — la segnalazione dell'utente del 2026-08-24.
        //
        // Il criterio «lato opposto» guarda a 30 unita' dalla corsia box: non
        // sa niente di cosa c'e' 200 unita' piu' in la'. Qui glielo si chiede.
        const parkOffset = scegliOffset(trackPts, pPark, nPark, side, barrierDist);

        for (let r = 0; r < PARK_ROWS; r++) {
            for (let c = 0; c < PARK_COLS; c++) {
                const off = parkOffset + r * PARK_STEP_Z;
                const lungo = (c - (PARK_COLS - 1) / 2) * PARK_STEP_X;
                // rotY = tangPark e NON tangPark + PI/2: l'auto e' lunga 5.2 e
                // larga 2.3, e in un parcheggio la LUNGHEZZA sta lungo la
                // corsia di manovra (passo 7) mentre la larghezza sta
                // affiancata (passo 3.2). Ruotate di 90 gradi si accavallavano
                // di 2 unita' l'una sull'altra: ne entravano 20 su 36, e su
                // monte-rosso 7. Nessuno se n'era accorto perche' con
                // l'ingombro finto (6x6) si scartavano comunque.
                piazza(CAR_COLORS[(r * PARK_COLS + c) % CAR_COLORS.length],
                       pPark.x + nPark.nx * side * off + lx * lungo,
                       pPark.z + nPark.nz * side * off + lz * lungo,
                       tangPark, 'paddock-life');
            }
        }
        // Container in fondo al parcheggio, allineati: chiudono la vista
        // dietro le auto invece di stare sparsi dietro i garage.
        for (let c = 0; c < 5; c++) {
            const off = parkOffset + PARK_ROWS * PARK_STEP_Z + 14;
            const lungo = (c - 2) * 12;
            piazza('containerStack',
                   pPark.x + nPark.nx * side * off + lx * lungo,
                   pPark.z + nPark.nz * side * off + lz * lungo,
                   tangPark, 'paddock-life');
        }

        // Asfalto sotto il parcheggio: senza, le auto poggiano sull erba e
        // si leggono come abbandonate invece che parcheggiate. E una voce di
        // layout con le sue dimensioni, disegnata da f1.js come superficie
        // piana — la stessa strada del laghetto.
        layout.push({
            asset: null, category: 'parkingLot',
            x: pPark.x + nPark.nx * side * (parkOffset + (PARK_ROWS - 1) * PARK_STEP_Z / 2),
            y: 0,
            z: pPark.z + nPark.nz * side * (parkOffset + (PARK_ROWS - 1) * PARK_STEP_Z / 2),
            rotY: tangPark,
            larghezza: PARK_COLS * PARK_STEP_X + 8,
            profondita: PARK_ROWS * PARK_STEP_Z + 8,
            scale: 1,
        });

        // Motorhome e camion accanto al parcheggio, non dietro i garage.
        //
        // Stavano nella fascia fra la corsia box e il prato: lì un mezzo
        // lungo 15 unità è schiacciato fra edifici alti 13 e non si vede
        // (segnalato dall'utente: "sono piccolissimi rispetto ai box e dietro
        // di essi non si vedono"). Qui formano invece un'area logistica
        // coerente insieme al parcheggio e ai container — e a 210 unità
        // stanno in una fascia libera, dove hanno spazio per leggersi.
        for (let m = 0; m < MEZZI_COUNT; m++) {
            const off = parkOffset - 34;
            const lungo = (m - (MEZZI_COUNT - 1) / 2) * 26;
            piazza(m % 3 === 2 ? 'truck' : 'motorhome',
                   pPark.x + nPark.nx * side * off + lx * lungo,
                   pPark.z + nPark.nz * side * off + lz * lungo,
                   tangPark + Math.PI / 2, 'paddock-life');
        }

        // --- Striscioni lungo la pista ------------------------------------
        // Stesso criterio dei cartelloni sponsor che gia' funzionano: a
        // barrierDist + BANNER_OFFSET dall'asse, cioe' OLTRE la barriera, e
        // orientati come la pista.
        //
        // Le due versioni precedenti sbagliavano in modi opposti: la prima li
        // metteva a passo fisso ovunque (cartelli piantati a caso, uno dentro
        // la corsia box), la seconda partiva dalla tribuna e li spostava VERSO
        // la pista, finendoci dentro. Qui la distanza si misura sempre
        // dall'asse del tracciato e va verso l'esterno.
        const n = trackPts.length;
        const lapLen = TrackGeometry.lapLength(trackPts);
        const passoBanner = Math.max(1, Math.round((BANNER_STEP / lapLen) * n));
        for (let i = 0; i < n; i += passoBanner) {
            const p = trackPts[i];
            if (p.bridge) continue;
            if (TrackGeometry.nearestPoint(pitPts, p.x, p.z).dist < PIT_CLEARANCE) continue;
            const { nx, nz } = TrackGeometry.normalAt(trackPts, i, true);
            const lato = (Math.floor(i / passoBanner) % 2 === 0) ? 1 : -1;
            const off = barrierDist + BANNER_OFFSET;
            const x = p.x + nx * lato * off, z = p.z + nz * lato * off;
            // Mai dentro l'anello: sul lato interno di una curva stretta la
            // normale punta verso l'infield, dove il cartello darebbe le
            // spalle a tutti.
            if (TrackGeometry.isInsideLoop(trackPts, x, z)) continue;
            // Fronte verso la PISTA, come i cartelloni sponsor: la stessa
            // formula di sceneryLandmarks.placeBeside. Con la tangente il
            // banner restava ortogonale all'asfalto, cioè di taglio, e la
            // faccia colorata guardava lungo il rettilineo invece che verso
            // chi corre.
            piazza('banner', x, z, Math.atan2(p.x - x, p.z - z), 'paddock-life');
        }

        return layout;
    }

    return { buildLayout, ROW_OFFSET };
});
