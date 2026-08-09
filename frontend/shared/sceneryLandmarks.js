// frontend/shared/sceneryLandmarks.js
//
// Elementi scenici UNICI per tracciato, ancorati a punti notevoli: torre di
// direzione gara, ponte semafori, podio, passerella pedonale. A differenza
// di sceneryTrackside.js (che distribuisce oggetti lungo tutto il giro), qui
// ogni asset compare una volta sola e la sua posizione è quasi obbligata dal
// ruolo che ha. Modulo puro, nessuna dipendenza da Three.js.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./trackGeometry.js'), require('./sceneryAssetSizes.js'));
    } else {
        root.SceneryLandmarks = factory(root.TrackGeometry, root.SceneryAssetSizes);
    }
})(typeof self !== 'undefined' ? self : this, function (TrackGeometry, SceneryAssetSizes) {

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
    const PODIUM_OFFSET_MARGIN = 30;  // oltre barrierDist, dietro la fila dei box
    const PODIUM_PIT_CLEARANCE = 12;  // dal bordo corsia box

    function spanScale(barrierDist, nativeHalfSpan) {
        return Math.max(1, (barrierDist + SPAN_CLEARANCE) / nativeHalfSpan);
    }

    // Punto a distanza `offset` dal centro pista sul lato `side`, con la
    // rotazione che fa guardare l'oggetto verso la pista.
    function placeBeside(trackPts, idx, offset, side, groundPts, barrierDist, embankOuter) {
        const p = trackPts[idx];
        const { nx, nz } = TrackGeometry.normalAt(trackPts, idx, true);
        const x = p.x + nx * offset * side;
        const z = p.z + nz * offset * side;
        return {
            x, z,
            rotY: Math.atan2(p.x - x, p.z - z),
            y: TrackGeometry.terrainHeightAt(groundPts, x, z, barrierDist, embankOuter),
        };
    }

    // Asset che attraversa la pista: centrato sull'asse, allineato alla
    // tangente (la campata è modellata lungo X locale) e scalato per
    // scavalcare le barriere.
    function placeAcross(trackPts, idx, groundPts, barrierDist, embankOuter, nativeHalfSpan) {
        const p = trackPts[idx];
        const t = TrackGeometry.tangentAt(trackPts, idx, true);
        return {
            x: p.x, z: p.z,
            y: TrackGeometry.terrainHeightAt(groundPts, p.x, p.z, barrierDist, embankOuter),
            // +π: il fronte dell'asset (+Z locale) allineato alla tangente
            // guarderebbe nella direzione di MARCIA, cioè darebbe le spalle
            // alle auto in arrivo — alla partenza si vedeva il retro del
            // ponte semafori invece delle luci.
            rotY: Math.atan2(t.tx, t.tz) + Math.PI,
            scale: spanScale(barrierDist, nativeHalfSpan),
        };
    }

    function buildLandmarks(trackPts, pitPts, barrierDist, mainSide, embankOuter,
                            playerBoxFootprints, insidePlayerBoxFootprint,
                            fitsUnderBridge, pitRoadHalf, accepted) {
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
        function freeOf(asset, cand, scale) {
            const item = { asset, x: cand.x, z: cand.z, rotY: cand.rotY,
                           y: cand.y, scale: scale || 1 };
            for (const p of placed) {
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
                                     -mainSide, groundPts, barrierDist, embankOuter);
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
        const gantryWalk = TrackGeometry.walkClosedLoop(trackPts, 0, GANTRY_AHEAD_OF_GRID);
        for (let d = 0; d < 200; d += 4) {
            const idx = (gantryWalk.fromIdx + d) % n;
            const cand = placeAcross(trackPts, idx, groundPts, barrierDist,
                                     embankOuter, GANTRY_NATIVE_HALF_SPAN);
            if (!freeOf('startGantry', cand, cand.scale)) continue;
            layout.push({ asset: 'startGantry', category: 'landmark', ...cand });
            break;
        }

        // Passerella: circa a mezzo giro dal gantry, per non duplicare la
        // stessa silhouette nello stesso tratto. Si cerca però il punto utile
        // più vicino a metà giro, scartando i tratti sopraelevati e quelli
        // con un cavalcavia sopra: a indice fisso, su "prova" cadeva proprio
        // sotto un ponte e lo attraversava (top a 13.3 contro un intradosso
        // a 11.2).
        const half = Math.floor(n / 2);
        for (let d = 0; d < Math.floor(n / 4); d += 4) {
            for (const idx of [(half + d) % n, ((half - d) % n + n) % n]) {
                if (trackPts[idx].bridge) continue;
                const cand = placeAcross(trackPts, idx, groundPts, barrierDist, embankOuter,
                                         FOOTBRIDGE_NATIVE_HALF_SPAN);
                const topH = SPANNING_HEIGHTS.footbridge * cand.scale;
                if (!fits('footbridge', cand.x, cand.z, cand.y, topH)) continue;
                if (!freeOf('footbridge', cand, cand.scale)) continue;
                layout.push({ asset: 'footbridge', category: 'landmark', ...cand });
                d = n;   // trovato: esce da entrambi i cicli
                break;
            }
        }

        // Podio: nel paddock, lato corsia box, arretrato oltre la fila dei
        // box giocatore. Si scorre il giro finché non si trova un punto che
        // non cada dentro un box né dentro la corsia.
        for (let d = 0; d < n; d += 5) {
            const cand = placeBeside(trackPts, d % n, barrierDist + PODIUM_OFFSET_MARGIN,
                                     -mainSide, groundPts, barrierDist, embankOuter);
            if (insidePlayerBoxFootprint(cand.x, cand.z, playerBoxFootprints)) continue;
            if (TrackGeometry.nearestPoint(pitPts, cand.x, cand.z).dist < pitHalf + PODIUM_PIT_CLEARANCE) continue;
            if (!fits('podium', cand.x, cand.z, cand.y)) continue;
            if (!freeOf('podium', cand)) continue;
            layout.push({ asset: 'podium', category: 'landmark', ...cand, scale: 1 });
            break;
        }

        return layout;
    }

    return { buildLandmarks, GANTRY_NATIVE_HALF_SPAN, FOOTBRIDGE_NATIVE_HALF_SPAN };
});
