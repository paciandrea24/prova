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
    // Sotto questo muro il tratto è STRETTO. Non è un numero a sentimento: il
    // muro della via di fuga è bimodale sui quattro tracciati — sta a 13-15
    // dove la barriera è addosso alla pista, a 29.8-32.8 dove c'è la ghiaia, e
    // in mezzo non c'è quasi niente. 20 cade dentro il salto.
    const MURO_STRETTO = 20;
    // Frazione del `passoMinimo` che vale ANCHE in linea d'aria, fra due rami
    // del giro che si sfiorano. Il passo è un ritmo del giro — «non incontrare
    // due gru di fila» — e si misura lungo la pista; ma due esemplari a
    // cavallo di un tornante finiscono nella stessa inquadratura pur essendo
    // lontanissimi lungo il tracciato, e quella soglia serve a non ammucchiarli.
    // Un terzo mantiene le proporzioni fra famiglie già tarate: 62 unità per la
    // torre faro (185), 233 per il maxischermo (700).
    const FRAZIONE_IN_ARIA = 1 / 3;

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

    // Quali gruppi di contesto descrivono questo punto, in ordine di
    // preferenza. Il primo è il contesto proprio, l'eventuale secondo è la
    // rete di sicurezza.
    //
    // ⚠️ Fino al 2026-08-13 'stretto' stava in fondo a OGNI lista, come
    // ripiego universale: copriva il 34% di prova e il 55% di monte-rosso, e
    // qualunque asset lo dichiarasse finiva sparso su mezzo circuito. È metà
    // della ragione per cui il playtest ha bocciato la distribuzione.
    function etichette(c) {
        // Il viadotto vince su tutto: non è una preferenza ma un vincolo
        // fisico, e ciò che è più basso del dislivello lì sparisce alla vista.
        if (c.viadotto) return ['viadotto'];
        // Muro sottile: la barriera è addosso alla pista e oltre c'è poco. Non
        // ha senso provarci prima gli asset dei tratti larghi.
        if (c.muro <= MURO_STRETTO) return ['stretto'];
        // Sui tratti larghi 'aperto' fa da rete: se l'asset del contesto
        // specifico non entra, si prova quello generico invece di lasciare un
        // buco.
        if (c.curva && c.esterno) return ['curvaEsterno', 'aperto'];
        if (c.visuale) return ['rettilineo', 'aperto'];
        return ['aperto'];
    }

    // La stessa fascia usata da trackScenery.js dopo la traslazione: larga
    // quanto la tribuna, profonda FASCIA_DAVANTI_TRIBUNA verso la pista.
    // Davanti a una tribuna ci va solo la sua rete.
    function davantiAUnaTribuna(v, grandstands) {
        return grandstands.some(g => {
            const co = Math.cos(g.rotY || 0), si = Math.sin(g.rotY || 0);
            const dx = v.x - g.x, dz = v.z - g.z;
            const du = dx * co - dz * si;
            const df = dx * si + dz * co;
            const meta = (SceneryAssetSizes.sizeOf(g.asset).w * (g.scale || 1)
                        + SceneryAssetSizes.sizeOf(v.asset).w * (v.scale || 1)) / 2;
            return Math.abs(du) <= meta && df > 0 && df <= FASCIA_DAVANTI_TRIBUNA;
        });
    }

    function buildInfrastructure(ctx) {
        const { trackPts, pitPts, barrierDist, pitRoadHalf, barrierProfile,
                accepted = [], grandstands = [], spanning = [], palette } = ctx;
        if (!palette || !palette.length) return [];

        const n = trackPts.length;
        const giro = TrackGeometry.lapLength(trackPts);
        const passoCampioni = Math.max(1, Math.round(PASSO / (giro / n)));
        const groundPts = trackPts.filter(p => !p.bridge);
        const curve = SceneryTrackside.findCorners(trackPts);
        const fitsUnderBridge = ctx.fitsUnderBridge || (() => true);
        const insideBox = ctx.insidePlayerBoxFootprint || (() => false);
        const base = { trackPts, barrierProfile, barrierDist,
                       embankStart: ctx.embankStart, embankOuter: ctx.embankOuter,
                       groundPts, curve };

        const posate = [];
        // Campione di posa di ciascuna, in parallelo a `posate`: serve a
        // misurare la spaziatura lungo il giro, e non finisce nel layout.
        const campioneDi = [];
        const unitaPerCampione = giro / n;
        // Distanza fra due campioni lungo la pista, sul giro CHIUSO: fra il
        // campione 10 e il 990 di mille corrono 20 campioni, non 980.
        const lungoLaPista = (a, b) => {
            const d = Math.abs(a - b);
            return Math.min(d, n - d) * unitaPerCampione;
        };

        for (let i = 0; i < n; i += passoCampioni) {
            for (const lato of [1, -1]) {
                const c = contestoAl(base, i, lato);
                const gruppi = etichette(c);

                // Lista di PREFERENZA, non una scelta sola: se il primo asset
                // non entra si prova il successivo, invece di lasciare un buco.
                const candidati = [];
                for (const g of gruppi) {
                    for (const voce of palette) {
                        if (voce.contesti.indexOf(g) >= 0 && candidati.indexOf(voce) < 0) {
                            candidati.push(voce);
                        }
                    }
                }

                for (const voce of candidati) {
                    const dim = SceneryAssetSizes.sizeOf(voce.asset);
                    if (!dim) continue;

                    // VINCOLO 7 — accanto a un tratto sopraelevato solo ciò che
                    // è più alto del dislivello: sotto quella soglia l'oggetto
                    // prende la quota del terreno e sprofonda fuori dalla vista
                    // di chi guida.
                    if (c.viadotto && dim.h <= c.dislivello) continue;

                    // Posa: oltre il muro del PROPRIO lato, guardando la pista.
                    const d = c.muro + MARGINE_DAL_MURO + dim.d / 2;
                    const nrm = TrackGeometry.normalAt(trackPts, i, true);
                    const x = trackPts[i].x + nrm.nx * d * lato;
                    const z = trackPts[i].z + nrm.nz * d * lato;

                    // Spaziatura per famiglia: le gru non si ammucchiano e due
                    // maxischermi non si vedono insieme. È un RITMO DEL GIRO,
                    // quindi si misura LUNGO LA PISTA.
                    //
                    // ⚠️ Misurarla in linea d'aria — come faceva fino al
                    // 2026-08-16 — svuota i tratti che passano accanto a un
                    // altro ramo del tracciato. Sul viadotto di `prova` non
                    // entrava più niente: 730 unità di pista spoglie, il buco
                    // più lungo del circuito, e su 56 candidati scartati lì 46
                    // erano bloccati da un oggetto che lungo il giro stava fra
                    // 700 e 2249 unità di distanza. Lo stesso difetto era già
                    // annotato per il vuoto 624-722 di `monte-rosso`, dove il
                    // giro è 1177 e un raggio di 260-700 copre quasi tutto.
                    //
                    // Contro l'ammasso visivo fra due rami che si sfiorano
                    // resta la soglia in linea d'aria, ridotta a
                    // FRAZIONE_IN_ARIA. ⚠️ Anche quella si misura fra le
                    // posizioni degli OGGETTI, non fra l'oggetto e il centro
                    // pista.
                    const troppoVicino = posate.some((v, k) => v.asset === voce.asset
                        && (lungoLaPista(campioneDi[k], i) < voce.passoMinimo
                            || Math.hypot(v.x - x, v.z - z)
                               < voce.passoMinimo * FRAZIONE_IN_ARIA));
                    if (troppoVicino) continue;

                    const y = TrackGeometry.terrainHeightAt(
                        groundPts, x, z, ctx.embankStart, ctx.embankOuter);
                    const cand = {
                        asset: voce.asset, category: 'infrastructure',
                        suMisuraSulMuro: !!barrierProfile,
                        x, y, z,
                        rotY: Math.atan2(trackPts[i].x - x, trackPts[i].z - z),
                        scale: 1,
                    };

                    // VINCOLO 6 — deve guardare la pista che ha davvero davanti.
                    if (!TrackGeometry.guardaVersoLaPista(trackPts, cand)) continue;
                    // VINCOLO 3 — corsia box e box giocatore.
                    if (TrackGeometry.nearestPoint(pitPts, x, z).dist
                        < pitRoadHalf + dim.d / 2 + 6) continue;
                    if (insideBox(x, z, ctx.playerBoxFootprints)) continue;
                    // VINCOLO 4 — cavalcavia e campate che scavalcano la pista.
                    if (!fitsUnderBridge(voce.asset, x, z, y)) continue;
                    if (spanning.some(p => SceneryAssetSizes.itemsOverlap(cand, p))) continue;
                    // VINCOLO 2 — mai dentro un'altra struttura, né dentro una
                    // già posata da questa stessa passata.
                    if (accepted.some(p => SceneryAssetSizes.itemsOverlap(cand, p))) continue;
                    if (posate.some(p => SceneryAssetSizes.itemsOverlap(cand, p))) continue;
                    // VINCOLO 5 — mai nella fascia davanti a una tribuna.
                    if (davantiAUnaTribuna(cand, grandstands)) continue;
                    // VINCOLO 1 — mai nella via di fuga, e sui QUATTRO angoli:
                    // il muro cambia sotto l'oggetto, il campione del centro
                    // non dice nulla su dove finiscono le estremità.
                    if (barrierProfile && SceneryAssetSizes.footprintCorners(cand).some(k => {
                        const q = TrackGeometry.nearestPoint(trackPts, k.x, k.z);
                        const nq = TrackGeometry.normalAt(trackPts, q.index, true);
                        const l = Math.sign((k.x - trackPts[q.index].x) * nq.nx +
                                            (k.z - trackPts[q.index].z) * nq.nz) || 1;
                        return TrackGravel.barrierAt(barrierProfile, q.index, l) - q.dist > 0;
                    })) continue;

                    posate.push(cand);
                    campioneDi.push(i);
                    break;   // uno per punto e per lato
                }
            }
        }
        return posate;
    }

    return { buildInfrastructure, contestoAl, etichette,
             PASSO, MARGINE_DAL_MURO, FASCIA_DAVANTI_TRIBUNA, VISUALE,
             RAGGIO_RETTILINEO, MURO_STRETTO };
});
