// frontend/shared/trackScenery.js
//
// Genera un layout deterministico di oggetti scenici (natura, tribune con
// pubblico, zona paddock) intorno a un tracciato F1, usando gli stessi
// punti campionati (trackPts/pitPts) di TrackMeshBuilder. Modulo puro,
// nessuna dipendenza da Three.js o il browser — chi lo consuma (frontend/f1.js)
// decide come renderizzare ogni voce del layout.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./trackGeometry.js'));
    else root.TrackScenery = factory(root.TrackGeometry);
})(typeof self !== 'undefined' ? self : this, function (TrackGeometry) {

    // Hash FNV-1a 32 bit di una stringa: seed deterministico dall'id del
    // tracciato, così lo stesso tracciato genera sempre lo stesso layout
    // (tracciati diversi → layout diversi ma stabili nel tempo).
    function hashString(str) {
        let h = 0x811c9dc5;
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 0x01000193);
        }
        return h >>> 0;
    }

    // PRNG mulberry32: veloce, seedabile, sufficiente per uno scatter
    // visivo (non serve crittografico).
    function mulberry32(seed) {
        let a = seed >>> 0;
        return function () {
            a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function weightedPick(rng, weighted) {
        const total = weighted.reduce((s, w) => s + w.weight, 0);
        let r = rng() * total;
        for (const w of weighted) {
            r -= w.weight;
            if (r <= 0) return w.asset;
        }
        return weighted[weighted.length - 1].asset;
    }

    // Scala unica per tutti gli asset Kenney di questo file (natura, tribune,
    // paddock, folla). Verificata a runtime (bounding box mondo delle
    // istanze, 2026-07-22): a 3.5× — lo stesso fattore usato per
    // raceCarWhite in loadCarModel — le dimensioni sono realistiche (albero
    // grande ≈5.3m, personaggio ≈2.3m, tribuna ≈4.2m) ma percepite come
    // poco "presenti" in terza persona su un tracciato largo 22 unità: su
    // richiesta esplicita, scala aumentata a 6× per un effetto più
    // vistoso/"epico", sacrificando l'accuratezza proporzionale rispetto
    // all'auto (che resta a 3.5×, non toccata). Nessuna scala differenziata
    // per pack: il fattore funziona uniformemente su Racing Kit/Nature
    // Kit/Mini Characters, quindi si tiene una sola costante.
    const KENNEY_MODEL_SCALE = 6;

    const NATURE_ASSETS = [
        { asset: 'treeLarge', weight: 1, scale: KENNEY_MODEL_SCALE },
        { asset: 'treeSmall', weight: 1, scale: KENNEY_MODEL_SCALE },
    ];
    const NATURE_SCALE = Object.fromEntries(NATURE_ASSETS.map(a => [a.asset, a.scale]));

    const NATURE_ATTEMPTS     = 500;  // candidati casuali provati per lo scatter natura
    const NATURE_MIN_MARGIN   = 4;    // oltre barrierDist: distanza minima dalla pista
    const NATURE_MAX_MARGIN   = 70;   // oltre barrierDist: distanza massima dalla pista
    const NATURE_MIN_SPACING  = 7;    // tra due oggetti natura
    const STRUCTURE_CLEARANCE = 18;   // natura vs tribune/paddock
    const PIT_NATURE_MARGIN   = 5;    // oltre pitRoadHalf

    const GRANDSTAND_OFFSET_MARGIN = 6;  // oltre barrierDist
    const GRANDSTAND_PIT_MARGIN    = 20; // oltre pitRoadHalf: evita di piazzare tribune sopra la corsia box
    // Le 3 varianti a 1 piano: grandStandCoveredRound/grandStandRound sono
    // escluse a priori (footprint circolare 1.64x1.64 contro 1.00x1.00 delle
    // altre — non affiancabili a un bordo dritto, verificato con un render di
    // confronto durante il brainstorming).
    const STAND_VARIANTS = ['grandStand', 'grandStandAwning', 'grandStandCovered'];

    // Tribuna principale: unica per tracciato, vicino al rettilineo di
    // partenza. 'grandStand' (base, senza tettoia sporgente) impilata su 2
    // livelli: verificato con un render di confronto a scala reale che
    // 'grandStandAwning' impilata romperebbe la tribuna sopra (il telo della
    // tettoia sporge oltre il modulo), mentre 'grandStand'/'grandStandCovered'
    // (tetto piatto o assente) si impilano senza artefatti — qui si usa la
    // variante senza tetto per restare leggera.
    const MAIN_STAND_ASSET         = 'grandStand';
    const MAIN_STAND_COLS          = 6;
    const MAIN_STAND_TIERS         = 2;
    // Dimensioni reali del modulo a KENNEY_MODEL_SCALE, misurate dal
    // bounding box del file .glb (il modulo trackScenery non ha accesso alla
    // mesh, solo f1.js la carica): raw x=1.00 y=0.90 z=1.00 → a scala 6,
    // 6 unità di passo tra moduli affiancati, 5.4 unità per livello.
    const MAIN_STAND_COL_SPACING   = 6.0;
    const MAIN_STAND_TIER_HEIGHT   = 5.4;
    // 10, non 6 come la tribuna normale: deve superare il raggio esterno dei
    // cartelloni sponsor del paddock (centrati a barrierDist+PADDOCK_MARGIN=5,
    // mezza profondita' billboard 1.44 a scala 6 -> bordo esterno a
    // barrierDist+6.44) altrimenti un cartellone finisce dentro la tribuna
    // principale (profondita' grandStand 6 unita' a scala 6, mezza profondita'
    // 3 -> serve MAIN_STAND_OFFSET_MARGIN >= 9.44; 10 per un margine di sicurezza).
    const MAIN_STAND_OFFSET_MARGIN = 10;

    const START_WINDOW_LEN           = 60;  // lunghezza d'arco totale intorno alla partenza
    const START_SPACING              = 12;
    const PADDOCK_MARGIN             = 5;   // oltre barrierDist, per i cartelloni sponsor partenza
    const PIT_BUILDING_OFFSET_MARGIN = 6;   // oltre pitRoadHalf
    const PIT_BUILDING_STEP_SAMPLES  = 25;
    // Meta' larghezza tangenziale della tribuna principale (6 moduli x 6
    // unita' di passo = 36, meta' 18): i cartelloni sponsor non vengono
    // piazzati sul suo stesso lato entro questa distanza dal centro,
    // altrimenti finiscono visivamente davanti alla tribuna (segnalato
    // dall'utente durante il playtest, non solo un rischio teorico).
    const MAIN_STAND_HALF_SPAN  = (MAIN_STAND_COLS * MAIN_STAND_COL_SPACING) / 2;
    // A differenza delle tribune (buildGrandstandLayout, che gia' controlla
    // GRANDSTAND_PIT_MARGIN), i cartelloni del rettilineo di partenza non
    // controllavano affatto la corsia box: su tutti e 3 i tracciati esistenti
    // almeno un cartellone finiva dentro la corsia (verificato per misura
    // diretta, non solo in teoria). 4 e' sufficiente a coprire la meta'
    // profondita' billboard (~1.44 a scala 6) con margine.
    const PADDOCK_PIT_CLEARANCE = 4;

    const POND_RADIUS    = 9;
    const POND_ATTEMPTS  = 60;
    const POND_CLEARANCE = 16;

    function isTooCloseToAny(accepted, x, z, ownSpacing) {
        for (const p of accepted) {
            const spacing = p.category === 'nature' ? Math.max(ownSpacing, NATURE_MIN_SPACING) : STRUCTURE_CLEARANCE;
            const dx = x - p.x, dz = z - p.z;
            if (dx * dx + dz * dz < spacing * spacing) return true;
        }
        return false;
    }

    // Zona paddock: cartelloni sponsor (billboard/billboardLow alternati)
    // lungo il rettilineo di partenza (finestra fissa intorno a trackPts[0],
    // stesso punto usato da buildStartLine), su entrambi i lati della pista,
    // + edifici box (pitsGarageClosed/pitsOffice alternati) lungo la corsia
    // box. Nessun PRNG: posizioni deterministiche a intervalli fissi, area
    // "propria" non condivisa con lo scatter natura.
    function buildPaddockLayout(trackPts, pitPts, barrierDist, pitRoadHalf, mainSide) {
        const layout = [];
        const n = trackPts.length;
        const stepLen = TrackGeometry.lapLength(trackPts) / n;
        const halfWindowSamples = Math.max(1, Math.round((START_WINDOW_LEN / 2) / stepLen));
        const spacingSamples    = Math.max(1, Math.round(START_SPACING / stepLen));

        let alt = 0;
        for (let d = -halfWindowSamples; d <= halfWindowSamples; d += spacingSamples) {
            const idx = ((d % n) + n) % n;
            const p = trackPts[idx];
            const { nx, nz } = TrackGeometry.normalAt(trackPts, idx, true);
            const asset = (alt % 2 === 0) ? 'billboard' : 'billboardLow';
            alt++;
            for (const side of [-1, 1]) {
                // Non piazzare un cartellone sul lato/finestra tangenziale
                // occupati dalla tribuna principale: altrimenti finisce
                // visivamente davanti alla tribuna, tra questa e la pista
                // (segnalato dall'utente durante il playtest).
                if (side === mainSide && Math.abs(d * stepLen) <= MAIN_STAND_HALF_SPAN) continue;

                const offset = barrierDist + PADDOCK_MARGIN;
                const x = p.x + nx * offset * side, z = p.z + nz * offset * side;
                // A differenza delle tribune (buildGrandstandLayout), questo
                // loop non controllava affatto la corsia box: su tutti e 3 i
                // tracciati esistenti un cartellone finiva dentro la corsia
                // (verificato per misura diretta). Si scarta lo slot invece
                // di ricollocarlo altrove.
                if (TrackGeometry.nearestPoint(pitPts, x, z).dist < pitRoadHalf + PADDOCK_PIT_CLEARANCE) continue;

                const rotY = Math.atan2(p.x - x, p.z - z);
                layout.push({ asset, category: 'paddock', x, y: p.y || 0, z, rotY, scale: KENNEY_MODEL_SCALE });
            }
        }

        let altBuilding = 0;
        for (let idx = 10; idx < pitPts.length - 10; idx += PIT_BUILDING_STEP_SAMPLES) {
            const p = pitPts[idx];
            const { nx, nz } = TrackGeometry.normalAt(pitPts, idx, false);
            // Lato "verso l'esterno" del tracciato principale: tra le due
            // direzioni normali, si sceglie quella che allontana di più dal
            // centro del circuito, generico per qualunque forma di corsia box.
            const distPlus  = TrackGeometry.nearestPoint(trackPts, p.x + nx, p.z + nz).dist;
            const distMinus = TrackGeometry.nearestPoint(trackPts, p.x - nx, p.z - nz).dist;
            const side = distPlus >= distMinus ? 1 : -1;
            const offset = pitRoadHalf + PIT_BUILDING_OFFSET_MARGIN;
            const x = p.x + nx * offset * side, z = p.z + nz * offset * side;
            const rotY = Math.atan2(p.x - x, p.z - z);
            const asset = (altBuilding % 2 === 0) ? 'pitsGarageClosed' : 'pitsOffice';
            altBuilding++;
            layout.push({ asset, category: 'paddock', x, y: p.y || 0, z, rotY, scale: KENNEY_MODEL_SCALE });
        }

        return layout;
    }

    // Tribune distribuite a intervalli regolari lungo il giro, alternando
    // lato sinistro/destro. Se lo slot calcolato cade troppo vicino alla
    // corsia box (o a una tribuna già piazzata), si cerca il punto valido
    // più vicino scorrendo avanti/indietro lungo il tracciato invece di
    // scartare subito la tribuna — un circuito con una corsia box lunga
    // (es. Monte Rosso) altrimenti perderebbe troppe tribune invece di
    // limitarsi a spostarle di qualche metro.
    function buildGrandstandLayout(trackPts, pitPts, barrierDist, pitRoadHalf, accepted, rng) {
        const layout = [];
        const lapLen = TrackGeometry.lapLength(trackPts);
        const count = Math.max(6, Math.min(10, Math.round(lapLen / 220)));
        const n = trackPts.length;
        const step = n / count;
        const searchWindow = Math.max(10, Math.floor(n / (count * 2)));

        function slotXZ(idx, side) {
            const p = trackPts[idx];
            const { nx, nz } = TrackGeometry.normalAt(trackPts, idx, true);
            const offset = barrierDist + GRANDSTAND_OFFSET_MARGIN;
            return { x: p.x + nx * offset * side, z: p.z + nz * offset * side, p };
        }

        function slotValid(idx, side) {
            const { x, z } = slotXZ(idx, side);
            if (TrackGeometry.nearestPoint(pitPts, x, z).dist < pitRoadHalf + GRANDSTAND_PIT_MARGIN) return false;
            if (isTooCloseToAny(accepted, x, z, STRUCTURE_CLEARANCE)) return false;
            return true;
        }

        for (let k = 0; k < count; k++) {
            const baseIdx = Math.floor(k * step) % n;
            const side = (k % 2 === 0) ? 1 : -1;
            let idx = -1;
            if (slotValid(baseIdx, side)) idx = baseIdx;
            for (let d = 1; idx < 0 && d <= searchWindow; d++) {
                if (slotValid((baseIdx + d) % n, side)) idx = (baseIdx + d) % n;
                else if (slotValid((baseIdx - d + n) % n, side)) idx = (baseIdx - d + n) % n;
            }
            if (idx < 0) continue;

            const { x, z, p } = slotXZ(idx, side);
            const rotY = Math.atan2(p.x - x, p.z - z);
            const asset = STAND_VARIANTS[Math.floor(rng() * STAND_VARIANTS.length)];
            const stand = { asset, category: 'grandstand', x, y: p.y || 0, z, rotY, scale: KENNEY_MODEL_SCALE };
            layout.push(stand);
            accepted.push(stand);
        }
        return layout;
    }

    // Lato del rettilineo di partenza piu' lontano dalla corsia box (stesso
    // criterio gia' usato altrove in questo file per un oggetto vicino ai
    // box). Calcolato una sola volta in generateLayout e condiviso da
    // buildPaddockLayout (per escludere i cartelloni dalla zona della
    // tribuna principale) e buildMainGrandstandLayout (per piazzare la
    // tribuna stessa) — evita di ricalcolarlo due volte e, soprattutto,
    // evita che i due calcoli possano dare lati diversi.
    function mainStandSide(trackPts, pitPts) {
        const p0 = trackPts[0];
        const { nx, nz } = TrackGeometry.normalAt(trackPts, 0, true);
        const distPlus  = TrackGeometry.nearestPoint(pitPts, p0.x + nx, p0.z + nz).dist;
        const distMinus = TrackGeometry.nearestPoint(pitPts, p0.x - nx, p0.z - nz).dist;
        return distPlus >= distMinus ? 1 : -1;
    }

    // Tribuna principale: 6 moduli affiancati x 2 livelli impilati, una
    // sola volta vicino a trackPts[0] (stesso punto di riferimento di
    // buildStartLine/buildPaddockLayout). `side` (1 o -1) viene passato da
    // generateLayout via mainStandSide(), condiviso con buildPaddockLayout.
    function buildMainGrandstandLayout(trackPts, barrierDist, side) {
        const layout = [];
        const n = trackPts.length;
        const stepLen = TrackGeometry.lapLength(trackPts) / n;
        const colSpacingSamples = Math.max(1, Math.round(MAIN_STAND_COL_SPACING / stepLen));

        const offset = barrierDist + MAIN_STAND_OFFSET_MARGIN;

        for (let tier = 0; tier < MAIN_STAND_TIERS; tier++) {
            for (let col = 0; col < MAIN_STAND_COLS; col++) {
                const d = Math.round((col - (MAIN_STAND_COLS - 1) / 2) * colSpacingSamples);
                const idx = ((d % n) + n) % n;
                const p = trackPts[idx];
                const { nx, nz } = TrackGeometry.normalAt(trackPts, idx, true);
                const x = p.x + nx * offset * side;
                const z = p.z + nz * offset * side;
                const rotY = Math.atan2(p.x - x, p.z - z);
                layout.push({
                    asset: MAIN_STAND_ASSET, category: 'grandstand-main',
                    x, y: (p.y || 0) + tier * MAIN_STAND_TIER_HEIGHT,
                    z, rotY, scale: KENNEY_MODEL_SCALE
                });
            }
        }
        return layout;
    }

    function trackBounds(trackPts, barrierDist) {
        const minXZ = { x: Infinity, z: Infinity };
        const maxXZ = { x: -Infinity, z: -Infinity };
        for (const p of trackPts) {
            minXZ.x = Math.min(minXZ.x, p.x); maxXZ.x = Math.max(maxXZ.x, p.x);
            minXZ.z = Math.min(minXZ.z, p.z); maxXZ.z = Math.max(maxXZ.z, p.z);
        }
        const pad = barrierDist + NATURE_MAX_MARGIN;
        return { xMin: minXZ.x - pad, xMax: maxXZ.x + pad, zMin: minXZ.z - pad, zMax: maxXZ.z + pad };
    }

    // Scatter tipo Poisson-disc (rejection sampling): candidati casuali
    // uniformi nel riquadro attorno al tracciato, filtrati per restare in
    // una fascia libera fuori dal corridoio pista/box e a distanza minima
    // dagli altri oggetti già accettati (di qualunque categoria).
    function buildNatureLayout(rng, trackPts, pitPts, barrierDist, pitRoadHalf, accepted) {
        const layout = [];
        const { xMin, xMax, zMin, zMax } = trackBounds(trackPts, barrierDist);

        for (let i = 0; i < NATURE_ATTEMPTS; i++) {
            const x = xMin + rng() * (xMax - xMin);
            const z = zMin + rng() * (zMax - zMin);

            const dTrack = TrackGeometry.nearestPoint(trackPts, x, z);
            if (dTrack.dist < barrierDist + NATURE_MIN_MARGIN) continue;
            if (dTrack.dist > barrierDist + NATURE_MAX_MARGIN) continue;
            if (TrackGeometry.nearestPoint(pitPts, x, z).dist < pitRoadHalf + PIT_NATURE_MARGIN) continue;
            if (isTooCloseToAny(accepted, x, z, NATURE_MIN_SPACING)) continue;

            const asset = weightedPick(rng, NATURE_ASSETS);
            const point = { asset, category: 'nature', x, y: dTrack.y, z, rotY: rng() * Math.PI * 2, scale: NATURE_SCALE[asset] };
            layout.push(point);
            accepted.push(point);
        }
        return layout;
    }

    // Tentativo singolo (non garantito) di piazzare un laghetto: cerca un
    // punto con un raggio libero sufficiente attorno; se non lo trova entro
    // il budget di tentativi, nessun laghetto su questo tracciato.
    function findPondSpot(rng, trackPts, pitPts, barrierDist, pitRoadHalf, accepted) {
        const { xMin, xMax, zMin, zMax } = trackBounds(trackPts, barrierDist);

        for (let i = 0; i < POND_ATTEMPTS; i++) {
            const x = xMin + rng() * (xMax - xMin);
            const z = zMin + rng() * (zMax - zMin);

            const dTrack = TrackGeometry.nearestPoint(trackPts, x, z);
            if (dTrack.dist < barrierDist + NATURE_MIN_MARGIN + POND_RADIUS) continue;
            if (dTrack.dist > barrierDist + NATURE_MAX_MARGIN) continue;
            if (TrackGeometry.nearestPoint(pitPts, x, z).dist < pitRoadHalf + PIT_NATURE_MARGIN + POND_RADIUS) continue;
            if (isTooCloseToAny(accepted, x, z, POND_CLEARANCE)) continue;

            return { category: 'pond', x, y: dTrack.y, z, radius: POND_RADIUS };
        }
        return null;
    }

    // trackData: JSON del tracciato (serve trackData.id per il seed e
    // trackData.pit.roadHalfWidth). trackPts/pitPts: punti già campionati
    // (TrackGeometry.sampleLoop/sampleOpenPath), stessi usati da
    // TrackMeshBuilder. barrierDist: distanza barriera dal centro pista
    // (BARRIER_D in f1.js).
    function generateLayout(trackData, trackPts, pitPts, barrierDist) {
        const rng = mulberry32(hashString(trackData.id));
        const pitRoadHalf = trackData.pit.roadHalfWidth;
        const side = mainStandSide(trackPts, pitPts);

        const paddock   = buildPaddockLayout(trackPts, pitPts, barrierDist, pitRoadHalf, side);
        const mainStand = buildMainGrandstandLayout(trackPts, barrierDist, side);
        const accepted  = [...paddock, ...mainStand];
        const grandstand = buildGrandstandLayout(trackPts, pitPts, barrierDist, pitRoadHalf, accepted, rng);

        const nature = buildNatureLayout(rng, trackPts, pitPts, barrierDist, pitRoadHalf, accepted);
        const pond   = findPondSpot(rng, trackPts, pitPts, barrierDist, pitRoadHalf, accepted);

        const layout = [...paddock, ...mainStand, ...grandstand, ...nature];
        if (pond) layout.push(pond);
        return layout;
    }

    return { generateLayout, hashString, mulberry32 };
});
