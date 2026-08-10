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

        // --- Fila principale: motorhome e camion alternati ----------------
        let messi = 0;
        for (let k = -Math.floor(ROW_MAX / 2); k <= Math.floor(ROW_MAX / 2); k++) {
            const idx = mid + k * passo;
            if (idx < 2 || idx >= pitPts.length - 2) continue;
            const p = pitPts[idx];
            const { nx, nz } = TrackGeometry.normalAt(pitPts, idx, false);
            const tang = Math.atan2(pitPts[idx + 1].x - pitPts[idx - 1].x,
                                    pitPts[idx + 1].z - pitPts[idx - 1].z);
            const asset = (messi % 3 === 2) ? 'truck' : 'motorhome';
            // I mezzi sono allineati con la corsia, non ruotati a caso: un
            // paddock è fatto di file ordinate.
            if (piazza(asset, p.x + nx * side * ROW_OFFSET, p.z + nz * side * ROW_OFFSET,
                       tang, 'paddock-life')) messi++;

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
        for (let r = 0; r < PARK_ROWS; r++) {
            for (let c = 0; c < PARK_COLS; c++) {
                const off = PARK_OFFSET + r * PARK_STEP_Z;
                const lungo = (c - (PARK_COLS - 1) / 2) * PARK_STEP_X;
                piazza(CAR_COLORS[(r * PARK_COLS + c) % CAR_COLORS.length],
                       pPark.x + nPark.nx * side * off + lx * lungo,
                       pPark.z + nPark.nz * side * off + lz * lungo,
                       tangPark + Math.PI / 2, 'paddock-life');
            }
        }
        // Container in fondo al parcheggio, allineati: chiudono la vista
        // dietro le auto invece di stare sparsi dietro i garage.
        for (let c = 0; c < 5; c++) {
            const off = PARK_OFFSET + PARK_ROWS * PARK_STEP_Z + 14;
            const lungo = (c - 2) * 12;
            piazza('containerStack',
                   pPark.x + nPark.nx * side * off + lx * lungo,
                   pPark.z + nPark.nz * side * off + lz * lungo,
                   tangPark, 'paddock-life');
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
            const tang = Math.atan2(trackPts[(i + 1) % n].x - trackPts[(i - 1 + n) % n].x,
                                    trackPts[(i + 1) % n].z - trackPts[(i - 1 + n) % n].z);
            piazza('banner', x, z, tang, 'paddock-life');
        }

        return layout;
    }

    return { buildLayout, ROW_OFFSET };
});
