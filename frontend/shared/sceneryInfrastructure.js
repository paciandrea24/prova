// frontend/shared/sceneryInfrastructure.js
//
// Infrastrutture di circuito distribuite lungo il giro: maxischermi, torri
// faro, terrazze, gru, torrette TV. Spec:
// docs/superpowers/specs/2026-08-13-f1-infrastrutture-circuito-design.md
//
// PERCHÉ BASTA CAMMINARE. Le tribune sono SCHIERE rigide e per questo non
// entrano in curva: è la ragione per cui quasi tutti i tratti spogli del
// circuito girano di 63-130°. Questi invece sono oggetti SINGOLI, quindi
// entrano proprio dove le schiere non entrano. Non serve un algoritmo che
// cerchi i vuoti e li tappi — basta camminare il giro e posare dove c'è
// posto, e i vuoti si chiudono da soli perché sono esattamente il posto che
// c'è. La misura dei vuoti sta nei test (`sceneryGaps.js`), non qui.
//
// Modulo puro, nessuna dipendenza da Three.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./trackGeometry.js'), require('./trackGravel.js'),
                                 require('./sceneryAssetSizes.js'),
                                 require('./sceneryTrackside.js'));
    } else {
        root.SceneryInfrastructure = factory(root.TrackGeometry, root.TrackGravel,
                                             root.SceneryAssetSizes, root.SceneryTrackside);
    }
})(typeof self !== 'undefined' ? self : this, function (TrackGeometry, TrackGravel,
                                                       SceneryAssetSizes, SceneryTrackside) {

    // Passo della camminata, in UNITÀ DI PISTA. ⚠️ Mai in campioni: il
    // campione vale 5.17 unità su `prova`, 3.21 su `new-monza`, 1.18 su
    // `monte-rosso` e 2.71 su `baku`, quindi una soglia espressa per campione
    // ha quattro comportamenti diversi in silenzio. È l'errore che in questo
    // progetto è già costato quattro round.
    const PASSO = 25;
    // Margine dell'oggetto oltre il muro. Le tribune stanno a muro+10 con una
    // mezza profondità di 6.4; qui si somma esplicitamente la mezza
    // profondità dell'asset, quindi questo è il gioco che resta fra il filo
    // del muro e il filo dell'oggetto.
    const MARGINE_DAL_MURO = 8;
    // Fascia davanti a una tribuna in cui non ci va altro che la sua rete:
    // stesso valore usato da trackScenery.js dopo la traslazione.
    const FASCIA_DAVANTI_TRIBUNA = 22;
    // Quanto guardare avanti per dire se la visuale è lunga, in unità.
    const VISUALE = 120;
    // Sopra questo raggio una curva si comporta come un rettilineo per chi ci
    // mette oggetti di fianco: il muro gira poco e un oggetto rigido lo segue.
    const RAGGIO_RETTILINEO = 200;

    // Che cosa descrive un punto del giro, dal punto di vista di chi ci deve
    // posare qualcosa di fianco.
    function contestoAl(ctx, idx, lato) {
        const { trackPts, barrierProfile, barrierDist } = ctx;
        const n = trackPts.length;
        const passo = TrackGeometry.lapLength(trackPts) / n;
        const groundPts = ctx.groundPts || trackPts.filter(p => !p.bridge);

        const p = trackPts[idx];
        const viadotto = !!p.bridge;
        // Il dislivello è quello fra la pista e il TERRENO sottostante: è
        // quanto sprofonda un oggetto posato lì di fianco, che prende la
        // quota del terreno e non quella della pista.
        const quotaTerreno = TrackGeometry.terrainHeightAt(
            groundPts, p.x, p.z, ctx.embankStart, ctx.embankOuter);
        const dislivello = Math.max(0, (p.y || 0) - quotaTerreno);

        // ⚠️ findCorners restituisce in `side` il lato ESTERNO della curva
        // (è il lato della ghiaia). Chi vuole l'interno usa -corner.side.
        const curve = ctx.curve || SceneryTrackside.findCorners(trackPts);
        let curva = null;
        for (const c of curve) {
            const arco = (c.endIdx - c.startIdx + n) % n;
            if ((idx - c.startIdx + n) % n <= arco) { curva = c; break; }
        }

        const muro = barrierProfile
            ? TrackGravel.barrierAt(barrierProfile, idx, lato)
            : barrierDist;

        // Visuale: quanto gira la pista nelle prossime VISUALE unità. Poco
        // giro = si vede lontano, ed è lì che un maxischermo ha senso.
        const avanti = Math.max(1, Math.round(VISUALE / passo));
        const t0 = TrackGeometry.tangentAt(trackPts, idx, true);
        const t1 = TrackGeometry.tangentAt(trackPts, (idx + avanti) % n, true);
        let giro = Math.atan2(t1.tx, t1.tz) - Math.atan2(t0.tx, t0.tz);
        while (giro > Math.PI) giro -= Math.PI * 2;
        while (giro < -Math.PI) giro += Math.PI * 2;

        return {
            idx, lato, viadotto, dislivello, muro,
            curva: !!curva && curva.radius < RAGGIO_RETTILINEO,
            esterno: !!curva && curva.side === lato,
            visuale: Math.abs(giro) < Math.PI / 6,
        };
    }

    function buildInfrastructure(ctx) {
        const { palette } = ctx;
        if (!palette || !palette.length) return [];
        return [];
    }

    return { buildInfrastructure, contestoAl,
             PASSO, MARGINE_DAL_MURO, FASCIA_DAVANTI_TRIBUNA, VISUALE, RAGGIO_RETTILINEO };
});
