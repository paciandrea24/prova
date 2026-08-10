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
    const ROW_OFFSET = 40;
    // Passo fra i mezzi: l'ingombro maggiore è il camion (19.1) più respiro.
    const ROW_STEP = 23;
    const ROW_MAX = 9;
    // Seconda fila, più arretrata: container e parcheggi.
    const BACK_OFFSET = 62;
    const PARK_ROWS = 3;
    const PARK_COLS = 7;
    const PARK_STEP_X = 3.2;    // auto affiancate, larghe 2.2
    const PARK_STEP_Z = 7.0;    // corsia di manovra fra due file
    // Striscioni: solo DIETRO LE TRIBUNE, non sparsi lungo il giro.
    //
    // La prima versione li metteva a passo fisso lungo tutto il tracciato, e
    // il risultato era esattamente quello che l'utente ha visto: cartelli
    // piantati a caso, uno perfino dentro la corsia box. Uno striscione ha
    // senso dove c'è pubblico che lo guarda — cioè davanti alle tribune — e
    // in nessun altro posto.
    const BANNER_STAND_OFFSET = 26;   // davanti alla tribuna, verso la pista
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

            // Container dietro, sfalsati rispetto ai mezzi.
            if (k % 2 === 0) {
                piazza('containerStack',
                       p.x + nx * side * BACK_OFFSET, p.z + nz * side * BACK_OFFSET,
                       tang, 'paddock-life');
            }
        }

        // --- Parcheggio: griglia ordinata, tutte le auto nello stesso verso -
        const idxPark = Math.max(2, mid - Math.floor(ROW_MAX / 2) * passo - passo);
        if (idxPark > 1 && idxPark < pitPts.length - 1) {
            const p = pitPts[idxPark];
            const { nx, nz } = TrackGeometry.normalAt(pitPts, idxPark, false);
            const tang = Math.atan2(pitPts[idxPark + 1].x - pitPts[idxPark - 1].x,
                                    pitPts[idxPark + 1].z - pitPts[idxPark - 1].z);
            // Direzione lungo la corsia, per disporre le colonne.
            const lx = Math.sin(tang), lz = Math.cos(tang);
            for (let r = 0; r < PARK_ROWS; r++) {
                for (let c = 0; c < PARK_COLS; c++) {
                    const off = ROW_OFFSET + 16 + r * PARK_STEP_Z;
                    const lungo = (c - (PARK_COLS - 1) / 2) * PARK_STEP_X;
                    piazza(CAR_COLORS[(r * PARK_COLS + c) % CAR_COLORS.length],
                           p.x + nx * side * off + lx * lungo,
                           p.z + nz * side * off + lz * lungo,
                           tang + Math.PI / 2, 'paddock-life');
                }
            }
        }

        // --- Striscioni davanti alle tribune ------------------------------
        // Le tribune sono già nel layout accettato: si prende la loro
        // posizione e si mette lo striscione fra loro e la pista, rivolto al
        // pubblico. Niente cartelli dove non c'è nessuno a guardarli.
        const tribune = accepted.filter(v => v.category === 'grandstand'
                                          || v.category === 'grandstand-main');
        for (let k = 0; k < tribune.length; k += 3) {
            const g = tribune[k];
            const vicino = TrackGeometry.nearestPoint(trackPts, g.x, g.z);
            if (vicino.dist > barrierDist + 90) continue;
            // Mai vicino alla corsia box: un cartello dentro la pit lane non è
            // un difetto estetico, è un oggetto in un'area di gara.
            if (TrackGeometry.nearestPoint(pitPts, g.x, g.z).dist < PIT_CLEARANCE) continue;
            // Verso la pista, lungo la direzione che unisce tribuna e asfalto.
            const dx = vicino.x - g.x, dz = vicino.z - g.z;
            const len = Math.hypot(dx, dz) || 1;
            piazza('banner',
                   g.x + (dx / len) * BANNER_STAND_OFFSET,
                   g.z + (dz / len) * BANNER_STAND_OFFSET,
                   Math.atan2(dx, dz) + Math.PI / 2, 'paddock-life');
        }

        return layout;
    }

    return { buildLayout, ROW_OFFSET };
});
