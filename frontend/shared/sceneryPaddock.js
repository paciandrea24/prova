// frontend/shared/sceneryPaddock.js
//
// Piazzamento del paddock: motorhome, camion, container, parcheggi, striscioni
// e spettatori in piedi lungo la recinzione.
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
    const ROW_OFFSET = 74;
    // Passo fra i mezzi: l'ingombro maggiore è il camion (19.1) più respiro.
    const ROW_STEP = 23;
    const ROW_MAX = 9;
    // Seconda fila, più arretrata: container e parcheggi.
    const BACK_OFFSET = 100;
    const PARK_ROWS = 3;
    const PARK_COLS = 7;
    const PARK_STEP_X = 3.2;    // auto affiancate, larghe 2.2
    const PARK_STEP_Z = 7.0;    // corsia di manovra fra due file
    // Recinzione: striscioni e pubblico stanno appena oltre la barriera. È
    // dentro la fascia riservata alla futura ghiaia, e va bene: sono appesi
    // alla recinzione, quindi si sposteranno insieme a lei. La regola della
    // ghiaia riguarda ciò che sta A TERRA nella via di fuga.
    const FENCE_OFFSET = 8;
    const BANNER_STEP = 120;
    const CROWD_GROUPS = 14;
    const CROWD_PER_GROUP = 5;

    const CAR_COLORS = ['parkedCarRed', 'parkedCarBlue', 'parkedCarWhite'];
    const STAND_VARIANTS = ['spectatorStandA', 'spectatorStandB'];

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

    function buildLayout(rng, trackPts, pitPts, barrierDist, accepted) {
        const layout = [];
        if (!pitPts || pitPts.length < 8) return layout;

        const mid = Math.floor(pitPts.length / 2);
        const side = latoOpposto(pitPts, trackPts, mid);
        const stepLen = Math.max(1e-3,
            Math.hypot(pitPts[1].x - pitPts[0].x, pitPts[1].z - pitPts[0].z));
        const passo = Math.max(1, Math.round(ROW_STEP / stepLen));

        function piazza(asset, x, z, rotY, category) {
            const voce = { asset, category, x, y: 0, z, rotY, scale: 1 };
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

        // --- Recinzione: striscioni e pubblico in piedi -------------------
        const n = trackPts.length;
        const lapLen = TrackGeometry.lapLength(trackPts);
        const passoBanner = Math.max(1, Math.round((BANNER_STEP / lapLen) * n));
        for (let i = 0; i < n; i += passoBanner) {
            const p = trackPts[i];
            if (p.bridge) continue;
            const { nx, nz } = TrackGeometry.normalAt(trackPts, i, true);
            const lato = (i / passoBanner) % 2 === 0 ? 1 : -1;
            const off = barrierDist + FENCE_OFFSET;
            const tang = Math.atan2(trackPts[(i + 1) % n].x - trackPts[(i - 1 + n) % n].x,
                                    trackPts[(i + 1) % n].z - trackPts[(i - 1 + n) % n].z);
            piazza('banner', p.x + nx * lato * off, p.z + nz * lato * off,
                   tang, 'paddock-life');
        }

        for (let g = 0; g < CROWD_GROUPS; g++) {
            const i = Math.floor(rng() * n);
            const p = trackPts[i];
            if (p.bridge) continue;
            const { nx, nz } = TrackGeometry.normalAt(trackPts, i, true);
            const lato = rng() < 0.5 ? 1 : -1;
            for (let k = 0; k < CROWD_PER_GROUP; k++) {
                const off = barrierDist + FENCE_OFFSET + 1.5 + rng() * 3;
                const lungo = (k - CROWD_PER_GROUP / 2) * 1.3;
                const tang = Math.atan2(trackPts[(i + 1) % n].x - trackPts[(i - 1 + n) % n].x,
                                        trackPts[(i + 1) % n].z - trackPts[(i - 1 + n) % n].z);
                layout.push({
                    asset: STAND_VARIANTS[k % STAND_VARIANTS.length],
                    category: 'paddock-life',
                    x: p.x + nx * lato * off + Math.sin(tang) * lungo,
                    y: 0,
                    z: p.z + nz * lato * off + Math.cos(tang) * lungo,
                    // Guardano la pista: la normale punta verso l'esterno,
                    // quindi l'orientamento è quello opposto.
                    rotY: Math.atan2(-nx * lato, -nz * lato),
                    scale: 1,
                });
            }
        }

        return layout;
    }

    return { buildLayout, ROW_OFFSET, FENCE_OFFSET };
});
