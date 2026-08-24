// frontend/shared/sceneryLandmarks.js
//
// Elementi scenici UNICI per tracciato, ancorati a punti notevoli: torre di
// direzione gara, ponte semafori, podio, passerella pedonale. A differenza
// di sceneryTrackside.js (che distribuisce oggetti lungo tutto il giro), qui
// ogni asset compare una volta sola e la sua posizione è quasi obbligata dal
// ruolo che ha. Modulo puro, nessuna dipendenza da Three.js.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./trackGeometry.js'), require('./sceneryAssetSizes.js'),
                                 require('./trackGravel.js'));
    } else {
        root.SceneryLandmarks = factory(root.TrackGeometry, root.SceneryAssetSizes, root.TrackGravel);
    }
})(typeof self !== 'undefined' ? self : this, function (TrackGeometry, SceneryAssetSizes, TrackGravel) {

    // Semiluce interna dei due asset che scavalcano la pista, misurata sui
    // .glb: il gantry ha i piloni a ±15 larghi 3 (filo interno 13.5), la
    // passerella le torri a ±16 larghe 4 (filo interno 14).
    const GANTRY_NATIVE_HALF_SPAN = 13.5;
    const FOOTBRIDGE_NATIVE_HALF_SPAN = 14;
    // Margine fra il filo interno del pilone e la barriera. Il vincolo è
    // scavalcare la BARRIERA, non la carreggiata: dimensionando sulla sola
    // larghezza pista i piloni finirebbero dentro le barriere su tutti i
    // tracciati esistenti (verificato: barrierDist è 15 su monte-rosso/prova
    // e 18 su new-monza, contro una semiluce nativa di 13.5).
    const SPAN_CLEARANCE = 1.5;

    // Altezza nativa degli asset che scavalcano la pista: va moltiplicata
    // per la scala di scavalcamento prima di verificare se ci stanno sotto
    // un eventuale cavalcavia.
    const SPANNING_HEIGHTS = { startGantry: 16.0, footbridge: 13.3 };

    // Quanto avanti al traguardo piazzare il ponte semafori: oltre la pole
    // (48 unità) con margine, così è davanti a tutta la griglia.
    const GANTRY_AHEAD_OF_GRID = 75;

    const TOWER_OFFSET_MARGIN = 20;   // oltre barrierDist
    // La torre è larga 14.6: deve stare ben oltre il bordo della corsia box,
    // altrimenti ci finisce sopra a cavallo.
    const TOWER_PIT_CLEARANCE = 16;
    // 14 e non 30: a 30 il podio finiva DIETRO la fila dei box, dove non lo
    // vede nessuno. A 14 sta nella fascia fra la barriera e la corsia box,
    // che e dove passano le auto a fine gara.
    const PODIUM_OFFSET_MARGIN = 14;  // oltre barrierDist, fra pista e corsia box
    const PODIUM_PIT_CLEARANCE = 12;  // dal bordo corsia box
    // Dagli IMBOCCHI della corsia (primo e ultimo punto), dove le auto si
    // immettono e si staccano dalla pista.
    const PODIUM_PIT_MOUTH_CLEARANCE = 60;

    // `daCoprire` è la distanza che la campata deve scavalcare: il muro vero
    // del punto in cui l'asset viene posato, non la barriera storica. Fino al
    // 2026-08-13 arrivava qui `barrierDist`, cioè 15.0 fisse: dopo le vie di
    // fuga il muro arriva a 34.5 e la passerella di `prova` restava corta di
    // 13 unità, con i piedi dentro la ghiaia.
    function spanScale(daCoprire, nativeHalfSpan) {
        return Math.max(1, (daCoprire + SPAN_CLEARANCE) / nativeHalfSpan);
    }

    // Il muro più lontano dei due lati al campione `idx`: una campata
    // scavalca la pista, quindi deve coprire il peggiore dei due, non quello
    // del lato da cui si comincia a misurare.
    function muroDaScavalcare(barrierProfile, barrierDist, idx) {
        if (!barrierProfile) return barrierDist;
        return Math.max(barrierDist,
                        TrackGravel.barrierAt(barrierProfile, idx, -1),
                        TrackGravel.barrierAt(barrierProfile, idx, 1));
    }

    // Punto a distanza `offset` dal centro pista sul lato `side`, con la
    // rotazione che fa guardare l'oggetto verso la pista.
    function placeBeside(trackPts, idx, offset, side, groundPts, barrierDist, embankStart, embankOuter) {
        const p = trackPts[idx];
        const { nx, nz } = TrackGeometry.normalAt(trackPts, idx, true);
        const x = p.x + nx * offset * side;
        const z = p.z + nz * offset * side;
        return {
            x, z,
            rotY: Math.atan2(p.x - x, p.z - z),
            y: TrackGeometry.terrainHeightAt(groundPts, x, z, embankStart, embankOuter),
        };
    }

    // Asset che attraversa la pista: centrato sull'asse, allineato alla
    // tangente (la campata è modellata lungo X locale) e scalato per
    // scavalcare le barriere.
    function placeAcross(trackPts, idx, groundPts, barrierDist, embankStart, embankOuter, nativeHalfSpan,
                         barrierProfile) {
        const p = trackPts[idx];
        const t = TrackGeometry.tangentAt(trackPts, idx, true);
        return {
            x: p.x, z: p.z,
            y: TrackGeometry.terrainHeightAt(groundPts, p.x, p.z, embankStart, embankOuter),
            // +π: il fronte dell'asset (+Z locale) allineato alla tangente
            // guarderebbe nella direzione di MARCIA, cioè darebbe le spalle
            // alle auto in arrivo — alla partenza si vedeva il retro del
            // ponte semafori invece delle luci.
            rotY: Math.atan2(t.tx, t.tz) + Math.PI,
            scale: spanScale(muroDaScavalcare(barrierProfile, barrierDist, idx), nativeHalfSpan),
        };
    }

    function buildLandmarks(trackPts, pitPts, barrierDist, mainSide, embankStart, embankOuter,
                            playerBoxFootprints, insidePlayerBoxFootprint,
                            fitsUnderBridge, pitRoadHalf, accepted, barrierProfile) {
        const layout = [];
        const groundPts = trackPts.filter(p => !p.bridge);
        const n = trackPts.length;
        const fits = fitsUnderBridge || (() => true);
        const pitHalf = pitRoadHalf || 0;
        const placed = accepted || [];

        // I landmark controllavano corsia box, box giocatore e cavalcavia, ma
        // NON le strutture già piazzate: il podio (12 x 7.1) finiva dentro un
        // garage box, compenetrandolo di 7.1 unità su "prova" — l'"edificio
        // dentro l'edificio" segnalato dall'utente. Il test è sui footprint
        // reali orientati (SceneryAssetSizes.itemsOverlap), non sulla distanza
        // fra centri: la torre è 14.6 x 12.6 e il gantry scavalca la pista,
        // un raggio unico non li descrive.
        // La zona dei box guardata sull'INGOMBRO e non sul solo centro: il
        // podio è 12 x 7.1 e può avere il centro fuori dal grembiule di
        // manovra sporgendoci dentro con mezzo fianco. È la stessa trappola
        // già chiusa per scenografia e decoro (docs/f1-notes.md, "SAT sugli
        // ANGOLI, non il centro"), qui rimasta aperta: è emersa avvicinando il
        // podio al traguardo su new-monza.
        function dentroZonaBox(asset, cand, scale) {
            if (insidePlayerBoxFootprint(cand.x, cand.z, playerBoxFootprints)) return true;
            const corners = SceneryAssetSizes.footprintCorners({
                asset, x: cand.x, z: cand.z, rotY: cand.rotY, y: cand.y, scale: scale || 1,
            });
            return (playerBoxFootprints || []).some(poly => SceneryAssetSizes.polysOverlap(corners, poly));
        }

        function freeOf(asset, cand, scale) {
            const item = { asset, x: cand.x, z: cand.z, rotY: cand.rotY,
                           y: cand.y, scale: scale || 1 };
            for (const p of placed) {
                if (SceneryAssetSizes.itemsOverlap(item, p)) return false;
            }
            // Anche i landmark piazzati in QUESTA chiamata: `placed` contiene
            // ciò che esisteva prima, non la torre appena messa qui sopra.
            // Finché il podio stava arretrato di 30 unità non se ne accorgeva
            // nessuno; avvicinandolo al traguardo il 2026-08-10 è finito
            // addosso alla torre su monte-rosso.
            for (const p of layout) {
                if (SceneryAssetSizes.itemsOverlap(item, p)) return false;
            }
            return true;
        }

        // Torre di direzione: sul lato OPPOSTO alla tribuna principale, così
        // le due strutture alte non si accavallano viste dal rettilineo.
        // Scorre il giro finché non trova un punto che non sia sopra la
        // corsia box: piazzata rigidamente all'indice 0 finiva a cavallo
        // della corsia (segnalato dall'utente sul tracciato "prova").
        for (let d = 0; d < n; d += 5) {
            const cand = placeBeside(trackPts, d % n, barrierDist + TOWER_OFFSET_MARGIN,
                                     -mainSide, groundPts, barrierDist, embankStart, embankOuter);
            if (TrackGeometry.nearestPoint(pitPts, cand.x, cand.z).dist < pitHalf + TOWER_PIT_CLEARANCE) continue;
            if (insidePlayerBoxFootprint(cand.x, cand.z, playerBoxFootprints)) continue;
            if (!fits('raceControlTower', cand.x, cand.z, cand.y)) continue;
            if (!freeOf('raceControlTower', cand)) continue;
            layout.push({ asset: 'raceControlTower', category: 'landmark', ...cand, scale: 1 });
            break;
        }

        // Ponte semafori: NON sul traguardo ma davanti alla griglia.
        //
        // Le auto si schierano DOPO la linea (TrackGeometry.GRID_START = 48
        // per la pole, GRID_STAGGER = 8 di arretramento a scalare), quindi un
        // gantry all'indice 0 resta alle spalle di tutti e al via non si
        // vedono i semafori — segnalato dall'utente. Spostandolo oltre la
        // pole lo si inquadra da tutta la griglia, e soprattutto NON si tocca
        // la posizione del traguardo, che è ciò su cui il server conta i giri.
        // Si parte dalla posizione ideale e si avanza finché non è libera da
        // altre strutture: su new-monza il gantry cadeva addosso a una tribuna.
        //
        // ⚠️ Il gantry NON è opzionale: da quando porta i semafori di partenza
        // veri (f1.js::accendiSemafori) è l'unico posto in cui il giocatore
        // legge il via, quindi ogni tracciato deve averlo. Se nessuna delle
        // collocazioni cercate è libera si posa comunque quella ideale: meglio
        // un gantry che sfiora una tribuna che una gara senza semaforo.
        //
        // ⚠️ Quanto puo' allontanarsi dalla posizione ideale pur di trovare
        // posto, in UNITA' DI PISTA e non in campioni. Il ciclo di prima
        // avanzava «fino a 200» contando CAMPIONI, e un campione vale 1.18
        // unita' su monte-rosso e 5.17 su prova: su melbourne 48 campioni
        // erano 226 unita', tre volte la distanza voluta, e al via non si
        // vedevano piu' i semafori. Misurato il 2026-08-24.
        const FINESTRA_GANTRY_UNITA = 40;
        const gantryWalk = TrackGeometry.walkClosedLoop(trackPts, 0, GANTRY_AHEAD_OF_GRID);
        const passoPista = TrackGeometry.lapLength(trackPts) / n;
        const passiFinestra = Math.max(1, Math.round(FINESTRA_GANTRY_UNITA / passoPista));
        let gantryPosato = null;
        // Si cerca ALTERNANDO avanti e indietro attorno alla posizione ideale,
        // non solo in avanti: cercando da un lato solo, su una pista dove il
        // fronte del traguardo occupa tutta la finestra si finiva per ripiegare
        // sull'ideale e compenetrare la tribuna principale (melbourne, 2.93
        // unità). Indietro c'è lo stesso spazio, e non lo guardava nessuno.
        for (let passo = 0; passo <= passiFinestra * 2; passo++) {
            const d = (passo % 2 === 0) ? (passo / 2) : -((passo + 1) / 2);
            const idx = ((gantryWalk.fromIdx + d) % n + n) % n;
            const cand = placeAcross(trackPts, idx, groundPts, barrierDist,
                                     embankStart, embankOuter, GANTRY_NATIVE_HALF_SPAN, barrierProfile);
            if (!gantryPosato) gantryPosato = cand;   // ripiego: la posizione ideale
            if (!freeOf('startGantry', cand, cand.scale)) continue;
            gantryPosato = cand;
            break;
        }
        if (gantryPosato) {
            layout.push({ asset: 'startGantry', category: 'landmark', ...gantryPosato });
        }

        // Passerella: circa a mezzo giro dal gantry, per non duplicare la
        // stessa silhouette nello stesso tratto. Si cerca però il punto utile
        // più vicino a metà giro, scartando i tratti sopraelevati e quelli
        // con un cavalcavia sopra: a indice fisso, su "prova" cadeva proprio
        // sotto un ponte e lo attraversava (top a 13.3 contro un intradosso
        // a 11.2).
        //
        // Fra i punti utili si preferiscono quelli dove il muro NON è
        // arretrato per una via di fuga: lì la campata resta di dimensioni
        // normali. Prima passata pretendendo un muro stretto; se un punto
        // così non esiste, seconda passata che accetta qualunque punto — e lì
        // `placeAcross` allunga la campata quanto serve, invece di lasciarla
        // corta con i piedi nella ghiaia. Su `prova` la passerella cadeva al
        // campione 412, dove il muro sta a 34.5, ed era corta di 13 unità.
        // ⚠️ Non una soglia assoluta sul muro: con le vie di fuga il muro
        // normale di `prova` sta a 29.8, cioè il doppio della barriera
        // storica, e una soglia tarata su quest'ultima non è mai soddisfatta
        // — la passerella finirebbe sempre nel ripiego, allungata a 81 unità
        // e alta 30. Si scandiscono invece TUTTI i punti utili e si tiene il
        // migliore, cioè quello col muro più stretto. Su `prova` la
        // differenza è fra una campata 51x19 e una 82x30.
        const half = Math.floor(n / 2);
        let migliore = null;
        for (let d = 0; d < Math.floor(n / 4); d += 4) {
            for (const idx of [(half + d) % n, ((half - d) % n + n) % n]) {
                if (trackPts[idx].bridge) continue;
                const cand = placeAcross(trackPts, idx, groundPts, barrierDist, embankStart, embankOuter,
                                         FOOTBRIDGE_NATIVE_HALF_SPAN, barrierProfile);
                const topH = SPANNING_HEIGHTS.footbridge * cand.scale;
                if (!fits('footbridge', cand.x, cand.z, cand.y, topH)) continue;
                if (!freeOf('footbridge', cand, cand.scale)) continue;
                // A parità di muro vince il primo trovato, e la scansione
                // parte da metà giro: la passerella resta il più possibile
                // dalla parte opposta al ponte semafori, che è il motivo per
                // cui la si mette lì.
                if (!migliore || cand.scale < migliore.scale) migliore = cand;
            }
        }
        if (migliore) layout.push({ asset: 'footbridge', category: 'landmark', ...migliore });

        // Podio: FRA I BOX E LA PISTA, vicino al traguardo.
        //
        // Prima si scorreva tutto il giro finché non si trovava posto, e il
        // risultato è che finiva dove capitava — l'utente l'ha trovato dietro
        // la torre di direzione, dove non lo vede nessuno. Un podio ha senso
        // solo dove passano le auto a fine gara.
        //
        // La ricerca è quindi limitata a una finestra stretta attorno a
        // trackPts[0], che è il riferimento del traguardo per tutti i
        // landmark, e alterna avanti e indietro partendo dal centro. Se in
        // quella fascia non c'è posto NON si ripiega altrove: meglio nessun
        // podio che un podio invisibile.
        // Due passate: prima la fascia stretta attorno al traguardo, che è
        // dove il podio DEVE stare; se lì non c'è posto — succede su
        // monte-rosso, dove fra barriera e corsia box lo spazio è occupato —
        // si allarga al giro intero, perché un podio mancante romperebbe la
        // cerimonia più di uno piazzato lontano.
        const finestra = Math.round(n * 0.06);   // ~6% del giro per lato
        const raggio = layout.some(l => l.asset === 'podium') ? 0 : n / 2;
        for (let passo = 0; passo <= raggio; passo += 4) {
            for (const verso of (passo === 0 ? [1] : [1, -1])) {
                const d = ((passo * verso) % n + n) % n;
                // Prima si prova ad ARRETRARE il podio restando vicino al
                // traguardo, poi ci si allontana lungo il giro. Prima si
                // provava un solo arretramento per posizione, e bastava che la
                // fascia stretta fosse occupata — su monte-rosso lo è, dalla
                // corsia box — perché il podio finisse dall'altra parte del
                // circuito. Meglio un podio un po' più indietro ma al
                // traguardo, che uno perfettamente allineato a 900 unità da lì.
                for (const arretra of [0, 16, 32]) {
                const offset = barrierDist + PODIUM_OFFSET_MARGIN + arretra;
                // `offset` e non piu' la costante: la riga qui sotto lo
                // calcolava e poi non lo usava, quindi il podio spinto lontano
                // dal traguardo restava comunque nella fascia stretta fra
                // barriera e corsia box — dove, su monte-rosso, cade proprio
                // all'uscita dei box (segnalato in playtest).
                const cand = placeBeside(trackPts, d % n, offset,
                                         -mainSide, groundPts, barrierDist, embankStart, embankOuter);
                if (dentroZonaBox('podium', cand)) continue;
                if (TrackGeometry.nearestPoint(pitPts, cand.x, cand.z).dist < pitHalf + PODIUM_PIT_CLEARANCE) continue;
                // Lontano dagli IMBOCCHI della corsia box: li' le auto si
                // immettono e si staccano dalla pista, ed e' lo spazio in cui
                // un volume di 12x7 sta peggio di ovunque altro. Il controllo
                // di distanza dalla corsia non basta: agli imbocchi la corsia
                // e la pista corrono affiancate, quindi un punto puo' essere
                // "lontano dalla corsia" e stare comunque in mezzo al traffico.
                if (Math.hypot(cand.x - pitPts[0].x, cand.z - pitPts[0].z) < PODIUM_PIT_MOUTH_CLEARANCE) continue;
                if (Math.hypot(cand.x - pitPts[pitPts.length - 1].x,
                               cand.z - pitPts[pitPts.length - 1].z) < PODIUM_PIT_MOUTH_CLEARANCE) continue;
            if (!fits('podium', cand.x, cand.z, cand.y)) continue;
            if (!freeOf('podium', cand)) continue;
            // Niente cartelloni DAVANTI, fra il podio e la pista: non si
            // sovrappongono — quindi freeOf li lascia passare — ma lo
            // nascondono a chi guarda dalla pista, ed è l'unico punto da cui
            // lo si guarda. Segnalato dall'utente su "prova": due cartelloni
            // proprio davanti.
            let oscurato = false;
            for (const p of placed) {
                if (p.category !== 'paddock') continue;
                // Sta fra il podio e l'asfalto? Vicino al podio e più vicino
                // di lui alla pista.
                if (Math.hypot(p.x - cand.x, p.z - cand.z) > 26) continue;
                const dPod = TrackGeometry.nearestPoint(trackPts, cand.x, cand.z).dist;
                const dCart = TrackGeometry.nearestPoint(trackPts, p.x, p.z).dist;
                if (dCart < dPod) { oscurato = true; break; }
            }
            if (oscurato) continue;
                layout.push({ asset: 'podium', category: 'landmark', ...cand, scale: 1 });
                passo = raggio + 1;   // trovato: esce da tutti i cicli
                break;
                }
                if (passo > raggio) break;
            }
        }

        return layout;
    }

    return { buildLandmarks, GANTRY_NATIVE_HALF_SPAN, FOOTBRIDGE_NATIVE_HALF_SPAN };
});
