// frontend/shared/trackScenery.js
//
// Genera un layout deterministico di oggetti scenici (natura, tribune con
// pubblico, zona paddock) intorno a un tracciato F1, usando gli stessi
// punti campionati (trackPts/pitPts) di TrackMeshBuilder. Modulo puro,
// nessuna dipendenza da Three.js o il browser — chi lo consuma (frontend/f1.js)
// decide come renderizzare ogni voce del layout.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./trackGeometry.js'), require('./sceneryLandmarks.js'),
                                 require('./sceneryTrackside.js'), require('./sceneryCrowd.js'),
                                 require('./sceneryAssetSizes.js'), require('./sceneryHills.js'));
    } else {
        root.TrackScenery = factory(root.TrackGeometry, root.SceneryLandmarks,
                                    root.SceneryTrackside, root.SceneryCrowd,
                                    root.SceneryAssetSizes, root.SceneryHills);
    }
})(typeof self !== 'undefined' ? self : this, function (TrackGeometry, SceneryLandmarks,
                                                        SceneryTrackside, SceneryCrowd,
                                                        SceneryAssetSizes, SceneryHills) {

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

    // Scala degli asset Kenney ANCORA in uso in questo file: dal 2026-08-09
    // solo gli alberi (treeLarge/treeSmall), che l'utente ha scelto di
    // tenere. Tutto il resto è passato ai modelli voxel custom di
    // frontend/assets/custom/circuit/ (vedi docs/f1-notes.md), modellati 1:1
    // in unità di gioco e quindi istanziati con scale 1.
    //
    // Storico del valore: a 3.5× — lo stesso fattore usato per l'auto — le
    // dimensioni erano realistiche ma percepite come poco "presenti" in
    // terza persona su un tracciato largo 22 unità, quindi su richiesta
    // esplicita si è passati a 6× per un effetto più vistoso.
    const KENNEY_MODEL_SCALE = 6;

    // Scala degli asset voxel custom: nessun moltiplicatore, sono già
    // modellati in unità di gioco.
    const CUSTOM_MODEL_SCALE = 1;

    // Gli alberi sono gli UNICI Kenney rimasti e restano alla loro scala:
    // non sono stati rimodellati in voxel custom per scelta dell'utente.
    const NATURE_ASSETS = [
        { asset: 'treeLarge', weight: 1, scale: KENNEY_MODEL_SCALE },
        { asset: 'treeSmall', weight: 1, scale: KENNEY_MODEL_SCALE },
    ];
    const NATURE_SCALE = Object.fromEntries(NATURE_ASSETS.map(a => [a.asset, a.scale]));

    // Scatter natura, valori originali. Un tentativo di allargare la fascia
    // a 200 unità per riempire l'orizzonte è stato annullato: portava gli
    // alberi da ~230 a oltre 700 e faceva scattare il gioco anche in
    // localhost, senza peraltro togliere la sensazione di prato infinito
    // (quella dipende dal terreno piatto, non dal numero di alberi).
    const NATURE_ATTEMPTS     = 500;  // candidati casuali provati per lo scatter natura
    const NATURE_MIN_MARGIN   = 4;    // oltre barrierDist: distanza minima dalla pista
    const NATURE_MAX_MARGIN   = 70;   // oltre barrierDist: distanza massima dalla pista
    const NATURE_MIN_SPACING  = 7;    // tra due oggetti natura
    const STRUCTURE_CLEARANCE = 22;   // natura vs tribune/paddock (era 18: strutture più grandi)
    const PIT_NATURE_MARGIN   = 5;    // oltre pitRoadHalf

    // Boschi che chiudono la vista oltre il terrapieno (Rif. richiesta utente
    // 2026-08-09: "colline, boschi folti e cose del genere per chiudere un po'
    // la vista intorno al circuito"). Distinti dallo scatter di NATURE_*, che
    // riempie la fascia vicino alla pista: qui gli alberi stanno in MACCHIE
    // (un centro, alberi fitti attorno), perché uno scatter uniforme su
    // un'area così grande dà un prato spennacchiato, non un bosco — ed è
    // esattamente il tentativo già bocciato in passato.
    const WOOD_CLUSTERS       = 130;   // macchie tentate per tracciato
    const WOOD_PER_CLUSTER    = 16;   // alberi tentati per macchia
    // Raggio STRETTO di proposito: allargarlo dirada la macchia invece di
    // ingrandirla, e un bosco rado non ferma lo sguardo. La massa visiva viene
    // dalla densità interna, non dall area coperta.
    const WOOD_CLUSTER_RADIUS = 30;
    const WOOD_MIN_SPACING    = 5;
    // Tetto complessivo, sopra i ~240 alberi di NATURE_*: a 700 totali il
    // gioco scattava anche in localhost (vedi il commento di NATURE_ATTEMPTS).
    // Da allora gli alberi sono esclusi dalle ombre, che di quel calo erano la
    // causa vera, ma il tetto resta esplicito e ritarabile.
    const WOOD_MAX_TREES      = 950;
    // Margine oltre il bordo del terrapieno entro cui NON si pianta: è la
    // fascia dove si finisce uscendo di pista, deve restare sgombra.
    const WOOD_MIN_MARGIN     = 20;

    // MACCHIE DI BOSCO: il fondale lontano.
    //
    // Un albero è largo 2-8 unità e a 500 di distanza occupa una frazione di
    // grado: per un fondale continuo ne servirebbero ~4500, che il gioco non
    // regge. Una macchia larga 75 ne sostituisce una trentina e a quella
    // distanza si legge allo stesso modo, perché i tronchi non si distinguono
    // comunque — misurato: 8.6 gradi di larghezza contro 0.24.
    //
    // Vanno SOLO in lontananza: da vicino si riconoscerebbe il blocco. Davanti
    // restano gli alberi veri, che fanno da transizione.
    const MASS_MIN_MARGIN  = 300;  // oltre barrierDist: prima ci sono alberi veri
    const MASS_MAX_MARGIN  = 900;  // oltre, la nebbia ha già mangiato tutto
    const MASS_MIN_SPACING = 62;   // meno della larghezza (75): le macchie si toccano
    const MASS_ATTEMPTS    = 900;
    const MASS_MAX_COUNT   = 170;

    // Ritarati il 2026-08-09 sui modelli voxel custom, ~3 volte più grandi
    // dei Kenney che sostituiscono (tribuna: da 6.0×5.38 a 19.2×12.3).
    const GRANDSTAND_OFFSET_MARGIN = 10; // era 6: la tribuna è profonda 12.8, mezza profondità 6.4
    const GRANDSTAND_PIT_MARGIN    = 24; // era 20: mezza diagonale della tribuna nuova
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
    // 7 e non 3: l'utente vuole una tribuna unica e lunga, che segua la pista
    // senza interruzioni (playtest 2026-08-09 — "non voglio un buco, voglio
    // grandstand continui che seguono l'andamento della pista"). A 18.4 di
    // passo la fila è lunga ~129 unità.
    const MAIN_STAND_COLS          = 7;
    // Distanza minima di una tribuna SPARSA dalla fila principale. Con la sola
    // STRUCTURE_CLEARANCE (22) una tribuna finiva a 32.4 dal modulo esterno:
    // troppo lontana per leggersi come continuazione della fila, troppo vicina
    // per leggersi come struttura a sé — cioè esattamente il "buco"
    // fotografato dall'utente. Meglio nessuna tribuna lì che una a metà strada.
    const MAIN_STAND_ISOLATION     = 60;
    // Le tribune secondarie sono SCHIERE, non moduli isolati: si allungano
    // finché lo slot resta valido, quindi si dimensionano da sé (lunghe sui
    // rettilinei, corte dove la corsia box o un cavalcavia le interrompono).
    // Sotto ROW_MIN_COLS la schiera viene scartata del tutto: una tribuna
    // isolata in mezzo al nulla è proprio ciò che l'utente ha segnalato come
    // "un buco" accanto alla fila lunga.
    const ROW_MAX_COLS = 6;
    const ROW_MIN_COLS = 2;
    // 1 livello e non 2: impilare due moduli era un'idea nata coi Kenney,
    // alti 5.38, dove serviva a dare volume. Col modulo custom alto 12.3 il
    // secondo livello si legge come due tribune sovrapposte — bocciato
    // dall'utente al playtest del 2026-08-09.
    const MAIN_STAND_TIERS         = 1;
    // Dimensioni reali del modulo custom, misurate sul .glb (il modulo
    // trackScenery non ha accesso alla mesh, solo f1.js la carica):
    // 19.2 largo × 12.3 alto × 12.8 profondo, a scala 1.
    // Esattamente la larghezza reale del modulo: i moduli si toccano senza
    // compenetrarsi. Prima era 18.4 — una compenetrazione voluta di 0.8 per
    // mascherare i varchi che il passo in campioni apriva qua e là; ora che
    // la fila si costruisce per distanza reale interpolata
    // (TrackGeometry.advanceToDistancePoint) il contatto è esatto e il
    // trucco non serve più.
    const MAIN_STAND_COL_SPACING   = 19.2;
    const MAIN_STAND_TIER_HEIGHT   = 12.3;  // era 5.4: altezza reale del modulo
    // Deve superare il raggio esterno dei cartelloni sponsor del paddock
    // (centrati a barrierDist+PADDOCK_MARGIN=5, mezza profondità billboard
    // 0.8 -> bordo esterno a barrierDist+5.8) sommato alla mezza profondità
    // della tribuna (6.4): serve >= 12.2, si tiene 14 per margine.
    const MAIN_STAND_OFFSET_MARGIN = 14;    // era 10 con i modelli Kenney

    const START_WINDOW_LEN           = 60;  // lunghezza d'arco totale intorno alla partenza
    const START_SPACING              = 20;  // era 12: i cartelloni custom sono larghi 16.4
    const PADDOCK_MARGIN             = 5;   // oltre barrierDist, per i cartelloni sponsor partenza
    // Gli edifici decorativi si allineano ai BOX GIOCATORE, non alla corsia.
    //
    // Era 10, cioè li metteva a 15 unità dall'asse corsia mentre i box veri
    // stanno a 28: finivano DAVANTI alla fila dei box, in mezzo allo spazio
    // dove l'auto si ferma e sterza per uscire — uno faceva da muro davanti
    // all'ultimo box (segnalato dall'utente 2026-08-10).
    // 19.4 allinea il FRONTE dell'edificio (profondo 14.7, quindi mezza
    // profondità 7.35) a quello del garage giocatore (che sta a
    // PLAYER_BOX_OFFSET_MARGIN - 11 = 12 oltre pitRoadHalf): 12 + 7.35 ≈ 19.4.
    // Così edifici decorativi e box compongono un'unica fila continua, che è
    // poi l'aspetto di una vera corsia box.
    const PIT_BUILDING_OFFSET_MARGIN = 19.4;
    // Gap fra il fianco di un edificio box e quello del successivo. Il passo
    // non è più una costante di distanza (era PIT_BUILDING_STEP_LEN = 24, che
    // contro edifici larghi 20.6 lasciava 3.4 unità di stacco e, quando un
    // candidato veniva scartato dai filtri, apriva un vuoto di 27): la
    // distanza fra due centri consecutivi si calcola dalle larghezze REALI dei
    // due modelli, così garage (20.6) e uffici (20.7) alternati formano un
    // fronte regolare invece di comparire "come messi a caso" (utente,
    // playtest 2026-08-09).
    const PIT_BUILDING_GAP           = 2;
    // Distanza minima degli edifici box dal corridoio pista: mezza profondità
    // dell'edificio (7.4) più margine, così l'imbocco della corsia resta
    // libero e leggibile.
    const PIT_BUILDING_TRACK_CLEARANCE = 10;
    // Tratto iniziale della corsia box lasciato libero da edifici, in unità:
    // è la zona d'imbocco, dove serve vedere dove si sta entrando.
    const PIT_BUILDING_ENTRY_CLEARANCE = 70;
    // Meta' larghezza tangenziale della tribuna principale (3 moduli x 19.4
    // di passo = 58.2, meta' 29.1): i cartelloni sponsor non vengono
    // piazzati sul suo stesso lato entro questa distanza dal centro,
    // altrimenti finiscono visivamente davanti alla tribuna (segnalato
    // dall'utente durante il playtest, non solo un rischio teorico).
    const MAIN_STAND_HALF_SPAN  = (MAIN_STAND_COLS * MAIN_STAND_COL_SPACING) / 2;
    // A differenza delle tribune (buildGrandstandLayout, che gia' controlla
    // GRANDSTAND_PIT_MARGIN), i cartelloni del rettilineo di partenza non
    // controllavano affatto la corsia box: su tutti e 3 i tracciati esistenti
    // almeno un cartellone finiva dentro la corsia (verificato per misura
    // diretta, non solo in teoria). 5 copre la mezza profondità del
    // cartellone custom (0.8) con ampio margine.
    const PADDOCK_PIT_CLEARANCE = 5;

    // Zona box giocatore (vedi TrackGeometry.pitBoxAnchors,
    // frontend/shared/pitBoxLoader.js): i box colorati reali di ogni
    // pilota occupano questo tratto della corsia box, un edificio/
    // cartellone/albero/laghetto decorativo lì finirebbe dentro/sopra un
    // modello vero. Un raggio fisso attorno al solo punto pitBoxIndex
    // (versione precedente, PIT_BOX_ZONE_HALFLEN=55) non copriva i box più
    // esterni della fila (arrivano a ±60m con MAX_GRID_SIZE pieno) —
    // bug osservato in playtest: edifici decorativi generati dentro i box
    // reali. Sostituito da un test punto-in-poligono contro l'ingombro
    // REALE di ciascun box (vedi playerBoxFootprintCorners/
    // insidePlayerBoxFootprint sotto): preciso indipendentemente dalla
    // posizione del box lungo la fila, niente più raggio da ritarare.
    //
    // Ingombro reale (world-space, bbox locale PRE-rotazione) e margine di
    // offset dalla corsia — STESSI valori di frontend/shared/pitBoxLoader.js
    // (PIT_BOX_OFFSET_MARGIN) per lo stesso modello, misurati sul .glb reale.
    // Dal 2026-08-09 il modello è il voxel custom
    // frontend/assets/custom/circuit/pitBox.glb: 21.8 x 22 unità, scala 1:1
    // (non più 3.5x) e origine al centro, quindi bounds simmetrici — il
    // vecchio f1PitBox.glb aveva il fronte lungo +X e bounds asimmetrici.
    // Se il modello cambia, aggiornare ANCHE pitBoxLoader.js.
    const PLAYER_BOX_LOCAL_BOUNDS = { xMin: -10.9, xMax: 10.9, zMin: -11, zMax: 11 };
    // DEVE restare uguale a PitBoxLoader.PIT_BOX_OFFSET_MARGIN, altrimenti la
    // scenografia esclude una zona diversa da quella dove i box vengono
    // davvero piazzati. Era già successo: quando PIT_BOX_CLEARANCE passò da 2
    // a 12 questo valore restò a 13.2 contro i 23.2 del loader, cioè la zona
    // protetta era 10 unità fuori posto. Ora un test in trackScenery.test.js
    // confronta le due costanti e fallisce se divergono.
    const PLAYER_BOX_OFFSET_MARGIN = 23;
    // Un po' di respiro visivo oltre il vero muro del box, per non far
    // spuntare un albero/cartellone letteralmente a contatto.
    const PLAYER_BOX_CLEARANCE = 3;
    // MAX_GRID_SIZE (backend/sockets/games/f1Bot.js): la scenografia viene
    // generata una volta al caricamento pista, PRIMA di sapere quanti
    // giocatori parteciperanno davvero — si esclude lo spazio per il caso
    // peggiore (griglia piena), non per il conteggio reale della partita.
    const PLAYER_BOX_MAX_COUNT = 6;

    // Angoli mondo dell'ingombro del box giocatore per un dato anchor —
    // stessa trasformazione di pitBoxLoader.js::loadPitBoxModel
    // (rotazione -90° perché l'apertura è modellata lungo +X locale, non
    // +Z), con PLAYER_BOX_CLEARANCE di margine extra su tutti i lati.
    function playerBoxFootprintCorners(anchor, trackPts, pitRoadHalf) {
        const nx = -anchor.tz, nz = anchor.tx;
        const distPlus  = TrackGeometry.nearestPoint(trackPts, anchor.x + nx, anchor.z + nz).dist;
        const distMinus = TrackGeometry.nearestPoint(trackPts, anchor.x - nx, anchor.z - nz).dist;
        const side = distPlus >= distMinus ? 1 : -1;
        const offset = pitRoadHalf + PLAYER_BOX_OFFSET_MARGIN;
        const bx = anchor.x + nx * offset * side, bz = anchor.z + nz * offset * side;
        const rotY = Math.atan2(anchor.x - bx, anchor.z - bz);

        const theta = rotY - Math.PI / 2;
        const cos = Math.cos(theta), sin = Math.sin(theta);
        const c = PLAYER_BOX_CLEARANCE;
        const { xMin, xMax, zMin, zMax } = PLAYER_BOX_LOCAL_BOUNDS;
        return [[xMin - c, zMin - c], [xMax + c, zMin - c], [xMax + c, zMax + c], [xMin - c, zMax + c]]
            .map(([lx, lz]) => ({ x: bx + lx * cos + lz * sin, z: bz - lx * sin + lz * cos }));
    }

    // Grembiule davanti al box: la fascia fra il bordo della corsia e il
    // fronte del garage. È dove l'auto si FERMA (lo stallo sta a
    // pitRoadHalf + PIT_STALL_CLEARANCE) e dove sterza per rientrare in
    // corsia — quindi va tenuta sgombra tanto quanto il box stesso.
    //
    // Senza questa zona era protetto solo il garage (da 17 a 39 unità
    // dall'asse corsia su una pista con pitRoadHalf 5), mentre gli edifici del
    // paddock stanno a pitRoadHalf + PIT_BUILDING_OFFSET_MARGIN = 15, cioè
    // ESATTAMENTE alla distanza dello stallo: uno di essi finiva davanti
    // all'ultimo box come un muro, togliendo lo spazio per uscire (segnalato
    // dall'utente 2026-08-10).
    function playerBoxApronCorners(anchor, trackPts, pitRoadHalf) {
        const nx = -anchor.tz, nz = anchor.tx;
        const distPlus  = TrackGeometry.nearestPoint(trackPts, anchor.x + nx, anchor.z + nz).dist;
        const distMinus = TrackGeometry.nearestPoint(trackPts, anchor.x - nx, anchor.z - nz).dist;
        const side = distPlus >= distMinus ? 1 : -1;

        // Dal bordo della corsia fino al fronte del garage.
        const dNear = pitRoadHalf;
        const dFar  = pitRoadHalf + PLAYER_BOX_OFFSET_MARGIN - PLAYER_BOX_LOCAL_BOUNDS.zMax;
        // Largo quanto il box, così l'auto ha spazio anche per uscire di
        // traverso invece che solo dritta.
        const halfW = PLAYER_BOX_LOCAL_BOUNDS.xMax + PLAYER_BOX_CLEARANCE;

        return [[dNear, -halfW], [dFar, -halfW], [dFar, halfW], [dNear, halfW]].map(([d, t]) => ({
            x: anchor.x + nx * d * side + anchor.tx * t,
            z: anchor.z + nz * d * side + anchor.tz * t,
        }));
    }

    // Test punto-in-poligono (ray casting): true se (x,z) cade dentro
    // l'ingombro reale di ALMENO uno dei box giocatore.
    // Come insidePlayerBoxFootprint ma per un OGGETTO con un ingombro, non per
    // un punto: un edificio profondo 14.7 può avere il centro fuori dalla zona
    // protetta e sporgerci dentro con mezzo fianco — ed è esattamente così che
    // un garage è finito a fare da muro davanti all'ultimo box, togliendo lo
    // spazio per uscire (segnalato dall'utente 2026-08-10).
    function itemHitsPlayerBoxZone(item, footprints) {
        const corners = SceneryAssetSizes.footprintCorners(item);
        for (const poly of footprints) {
            if (SceneryAssetSizes.polysOverlap(corners, poly)) return true;
        }
        return false;
    }

    function insidePlayerBoxFootprint(x, z, footprints) {
        for (const poly of footprints) {
            let inside = false;
            for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
                const xi = poly[i].x, zi = poly[i].z, xj = poly[j].x, zj = poly[j].z;
                const intersect = ((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi);
                if (intersect) inside = !inside;
            }
            if (inside) return true;
        }
        return false;
    }

    const POND_RADIUS    = 9;
    const POND_ATTEMPTS  = 60;
    const POND_CLEARANCE = 16;

    // Margine di sicurezza fra la cima di un oggetto e l'intradosso della
    // pista sopraelevata che ci passa sopra.
    const BRIDGE_HEADROOM = 1.0;

    // Costruisce il test "questo oggetto ci sta, sotto il ponte?".
    //
    // Serve perché terrainHeightAt lavora sui soli punti a terra: un oggetto
    // piazzato sotto un cavalcavia riceve la quota del terreno e, se è più
    // alto della luce del ponte, lo attraversa. Sul tracciato "prova" è
    // esattamente quello che succedeva a reti, tribune e torre (198 punti di
    // ponte fino a 11.5 unità di quota) — segnalato dall'utente con uno
    // screenshot, non un rischio teorico.
    function makeBridgeFilter(trackPts, barrierDist) {
        const bridgePts = trackPts.filter(p => p.bridge);
        // `heightOverride` serve per gli oggetti impilati (la tribuna
        // principale su 2 livelli è alta il doppio del singolo modulo).
        return function fitsUnderBridge(asset, x, z, groundY, heightOverride) {
            if (!bridgePts.length) return true;
            const bridgeY = TrackGeometry.bridgeHeightAt(bridgePts, x, z, barrierDist);
            if (bridgeY === Infinity) return true;
            const h = heightOverride || SceneryAssetSizes.heightOf(asset);
            return h <= (bridgeY - groundY) - BRIDGE_HEADROOM;
        };
    }

    function isTooCloseToAny(accepted, x, z, ownSpacing) {
        for (const p of accepted) {
            // 'woods' conta come vegetazione quanto 'nature': sono gli stessi
            // alberi, solo piantati sulle colline. Trattarli come strutture
            // imporrebbe loro STRUCTURE_CLEARANCE (22) e dei "boschi folti"
            // resterebbe un frutteto rado.
            const isVegetation = p.category === 'nature' || p.category === 'woods';
            const spacing = isVegetation ? Math.max(ownSpacing, NATURE_MIN_SPACING) : STRUCTURE_CLEARANCE;
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
    function buildPaddockLayout(trackPts, pitPts, barrierDist, pitRoadHalf, mainSide, embankOuter, playerBoxFootprints, fitsUnderBridge) {
        const layout = [];
        const groundPts = trackPts.filter(p => !p.bridge);
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
                if (insidePlayerBoxFootprint(x, z, playerBoxFootprints)) continue;

                const rotY = Math.atan2(p.x - x, p.z - z);
                const y = TrackGeometry.terrainHeightAt(groundPts, x, z, barrierDist, embankOuter);
                if (!fitsUnderBridge(asset, x, z, y)) continue;
                layout.push({ asset, category: 'paddock', x, y, z, rotY, scale: CUSTOM_MODEL_SCALE });
            }
        }

        // Edifici box: quota invariata (p.y || 0, dalla corsia box stessa) —
        // il terrapieno non copre la corsia box, fuori scope (vedi design).
        // Passo in unità convertito in campioni sulla base della spaziatura
        // reale dei punti di QUESTA corsia box.
        const pitStepLen = TrackGeometry.lapLength(pitPts) / pitPts.length;
        // Primo edificio ben oltre l'IMBOCCO della corsia: partendo
        // dall'indice 10 il primo cadeva a ~16 unità dall'ingresso e, essendo
        // largo 20.6, lo occupava di fatto rendendolo illeggibile. Il solo
        // controllo di distanza dalla pista non bastava, perché la corsia si
        // allontana subito ma l'edificio resta comunque addosso all'imbocco.
        const firstIdx = Math.max(10, Math.round(PIT_BUILDING_ENTRY_CLEARANCE / pitStepLen));
        const lastIdx = pitPts.length - 10;

        // Punto dove sorgerebbe un edificio al campione idx, già spostato sul
        // lato esterno della corsia: è fra i centri offsettati che deve valere
        // la spaziatura, non sull'asse della corsia.
        function buildingAt(idx) {
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
            return { x, z, idx, y: p.y || 0, rotY: Math.atan2(p.x - x, p.z - z) };
        }

        // Catena: ogni edificio si affianca al precedente alla distanza
        // dettata dalle LARGHEZZE REALI dei due modelli. Un candidato scartato
        // da un filtro fa avanzare di UN campione, non di un intero passo:
        // così il fronte si richiude subito dopo l'ostacolo invece di lasciare
        // un vuoto doppio (col passo fisso, su monte-rosso sopravviveva un
        // solo edificio in tutta la corsia).
        let altBuilding = 0;
        let idx = firstIdx;
        while (idx < lastIdx) {
            const asset = (altBuilding % 2 === 0) ? 'pitsGarageClosed' : 'pitsOffice';
            const b = buildingAt(idx);

            const blocked = itemHitsPlayerBoxZone(
                    { asset, x: b.x, z: b.z, rotY: b.rotY, scale: CUSTOM_MODEL_SCALE },
                    playerBoxFootprints)
                // Niente edifici all'IMBOCCO della corsia box, dove corsia e
                // pista corrono ancora affiancate: lì un edificio profondo
                // 14.7 si sovrappone all'ingresso e lo rende illeggibile
                // (segnalato dall'utente).
                || TrackGeometry.nearestPoint(trackPts, b.x, b.z).dist < barrierDist + PIT_BUILDING_TRACK_CLEARANCE
                || !fitsUnderBridge(asset, b.x, b.z, b.y);

            if (blocked) { idx++; continue; }

            layout.push({ asset, category: 'paddock', x: b.x, y: b.y, z: b.z,
                          rotY: b.rotY, scale: CUSTOM_MODEL_SCALE });
            altBuilding++;
            const nextAsset = (altBuilding % 2 === 0) ? 'pitsGarageClosed' : 'pitsOffice';
            const need = (SceneryAssetSizes.sizeOf(asset).w
                        + SceneryAssetSizes.sizeOf(nextAsset).w) / 2 + PIT_BUILDING_GAP;
            const hit = TrackGeometry.advanceToDistancePoint(
                pitPts, idx, 1, false, b, need, (i) => buildingAt(i));
            if (!hit) break;   // corsia finita
            idx = hit.idx;
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
    function buildGrandstandLayout(trackPts, pitPts, barrierDist, pitRoadHalf, accepted, rng, embankOuter, fitsUnderBridge, mainStand) {
        const layout = [];
        const groundPts = trackPts.filter(p => !p.bridge);
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
            // Mai di fianco a un tratto sopraelevato: la tribuna prenderebbe
            // la quota del terreno sottostante e finirebbe a intersecare il
            // viadotto (copertura "corrotta" segnalata dall'utente).
            if (trackPts[idx].bridge) return false;
            const { x, z } = slotXZ(idx, side);
            if (TrackGeometry.nearestPoint(pitPts, x, z).dist < pitRoadHalf + GRANDSTAND_PIT_MARGIN) return false;
            if (isTooCloseToAny(accepted, x, z, STRUCTURE_CLEARANCE)) return false;
            // Mai a ridosso della fila principale: o la tribuna continua la
            // fila (e allora la genera buildMainGrandstandLayout), o sta
            // altrove. La via di mezzo è il varco segnalato dall'utente.
            for (const m of (mainStand || [])) {
                if (Math.hypot(x - m.x, z - m.z) < MAIN_STAND_ISOLATION) return false;
            }
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

            // Una SCHIERA, non una tribuna sola (Rif. richiesta utente
            // 2026-08-10: "mi piacerebbe distribuissi queste lunghe schiere un
            // po' dove possibile lungo i rettilinei o curve principali").
            // La schiera si allunga finché lo slot resta valido, quindi si
            // dimensiona da sé: lunga sui rettilinei, corta dove la corsia box
            // o un cavalcavia la interrompono.
            const asset = STAND_VARIANTS[Math.floor(rng() * STAND_VARIANTS.length)];
            const modules = buildStandRow(
                trackPts, idx, side, barrierDist + GRANDSTAND_OFFSET_MARGIN, ROW_MAX_COLS,
                (m) => {
                    if (trackPts[m.idx].bridge) return false;
                    if (TrackGeometry.nearestPoint(pitPts, m.x, m.z).dist < pitRoadHalf + GRANDSTAND_PIT_MARGIN) return false;
                    for (const s of (mainStand || [])) {
                        if (Math.hypot(m.x - s.x, m.z - s.z) < MAIN_STAND_ISOLATION) return false;
                    }
                    // Contro le strutture già accettate si guarda l'ingombro
                    // reale, non un raggio: una schiera lunga sfiorerebbe
                    // sempre qualcosa con un raggio unico e resterebbe corta.
                    const y = TrackGeometry.terrainHeightAt(groundPts, m.x, m.z, barrierDist, embankOuter);
                    const cand = { asset, x: m.x, y, z: m.z, rotY: m.rotY, scale: CUSTOM_MODEL_SCALE };
                    for (const p of accepted) {
                        if (SceneryAssetSizes.itemsOverlap(cand, p)) return false;
                    }
                    return fitsUnderBridge(asset, m.x, m.z, y);
                });

            // Mai una tribuna isolata: o è una schiera leggibile, o niente.
            // Una singola in mezzo al nulla, o peggio a mezza distanza da una
            // schiera lunga, si legge come un buco (segnalato dall'utente).
            if (modules.length < ROW_MIN_COLS) continue;

            for (const m of modules) {
                const y = TrackGeometry.terrainHeightAt(groundPts, m.x, m.z, barrierDist, embankOuter);
                const stand = { asset, category: 'grandstand', x: m.x, y, z: m.z,
                                rotY: m.rotY, scale: CUSTOM_MODEL_SCALE };
                layout.push(stand);
                accepted.push(stand);
            }
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

    // Tribuna principale: una fila unica di MAIN_STAND_COLS moduli contigui
    // centrata su trackPts[0] (stesso riferimento di buildStartLine/
    // buildPaddockLayout), che segue la curvatura della pista. `side` (1 o -1)
    // arriva da generateLayout via mainStandSide(), condiviso con
    // buildPaddockLayout.
    //
    // I moduli si incatenano per DISTANZA REALE fra i centri offsettati
    // (TrackGeometry.advanceToDistance), non per passo in campioni: il
    // traguardo di "prova" è in curva (raggio 158) e i moduli stanno 29 unità
    // di lato, quindi un passo misurato sulla linea centrale dava distanze
    // reali di 14.3 e 17.2 invece dei 18.4 nominali — un modulo compenetrato
    // e un varco visibile, cioè il "buco al traguardo" segnalato dall'utente.
    // Catena di moduli contigui lungo la pista, a partire da startIdx e in
    // entrambe le direzioni. Il cuore della composizione delle tribune: usata
    // sia dalla fila principale sia dalle schiere secondarie, così hanno lo
    // stesso identico comportamento e un solo posto da correggere.
    //
    // La spaziatura si misura fra i CENTRI GIÀ OFFSETTATI DI LATO e con la
    // posizione interpolata fra due campioni: un passo espresso in campioni
    // sbaglia del 12% per il solo arrotondamento e ignora che su una curva gli
    // oggetti spostati di lato percorrono un arco diverso da quello dei
    // campioni — sono le due cause del "buco al traguardo".
    //
    // `accept(module)` decide se un modulo può stare lì: la catena si ferma al
    // primo rifiuto in quella direzione, così una schiera non salta un
    // ostacolo lasciando un vuoto in mezzo.
    function buildStandRow(trackPts, startIdx, side, offset, maxCols, accept) {
        function moduleAt(idx) {
            const p = trackPts[idx];
            const { nx, nz } = TrackGeometry.normalAt(trackPts, idx, true);
            const x = p.x + nx * offset * side;
            const z = p.z + nz * offset * side;
            return { x, z, idx, rotY: Math.atan2(p.x - x, p.z - z) };
        }

        // rotY si interpola come i due punti: fra campioni adiacenti la
        // differenza è di frazioni di grado, ma va normalizzata per non
        // attraversare il salto a ±π.
        function moduleBetween(prevIdx, idx, t) {
            const a = moduleAt(prevIdx), b = moduleAt(idx);
            let dRot = b.rotY - a.rotY;
            while (dRot > Math.PI) dRot -= Math.PI * 2;
            while (dRot < -Math.PI) dRot += Math.PI * 2;
            return {
                x: a.x + (b.x - a.x) * t,
                z: a.z + (b.z - a.z) * t,
                rotY: a.rotY + dRot * t,
                idx,
            };
        }

        const center = moduleAt(startIdx);
        if (!accept(center)) return [];
        const modules = [center];
        const back = Math.floor((maxCols - 1) / 2);
        const forward = maxCols - 1 - back;
        for (const dirWanted of [[1, forward], [-1, back]]) {
            const dir = dirWanted[0];
            let prev = center;
            for (let k = 0; k < dirWanted[1]; k++) {
                const hit = TrackGeometry.advanceToDistancePoint(
                    trackPts, prev.idx, dir, true, prev, MAIN_STAND_COL_SPACING,
                    (i) => moduleAt(i));
                if (!hit) break;
                const next = moduleBetween(hit.prevIdx, hit.idx, hit.t);
                if (!accept(next)) break;   // la schiera si ferma qui, non salta l'ostacolo
                prev = next;
                modules.push(prev);
            }
        }
        return modules;
    }

    function buildMainGrandstandLayout(trackPts, barrierDist, side, embankOuter, fitsUnderBridge) {
        const layout = [];
        const groundPts = trackPts.filter(p => !p.bridge);
        const stackHeight = MAIN_STAND_TIER_HEIGHT * MAIN_STAND_TIERS;

        const modules = buildStandRow(
            trackPts, 0, side, barrierDist + MAIN_STAND_OFFSET_MARGIN, MAIN_STAND_COLS,
            (m) => {
                // Se lì sopra passa un cavalcavia, la tribuna lo attraversa.
                const y = TrackGeometry.terrainHeightAt(groundPts, m.x, m.z, barrierDist, embankOuter);
                return fitsUnderBridge('__stack__', m.x, m.z, y, stackHeight);
            });

        for (const m of modules) {
            const baseY = TrackGeometry.terrainHeightAt(groundPts, m.x, m.z, barrierDist, embankOuter);
            for (let tier = 0; tier < MAIN_STAND_TIERS; tier++) {
                layout.push({
                    asset: MAIN_STAND_ASSET, category: 'grandstand-main',
                    x: m.x, y: baseY + tier * MAIN_STAND_TIER_HEIGHT,
                    z: m.z, rotY: m.rotY, scale: CUSTOM_MODEL_SCALE
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
    function buildNatureLayout(rng, trackPts, pitPts, barrierDist, pitRoadHalf, accepted, embankOuter, playerBoxFootprints, fitsUnderBridge) {
        const layout = [];
        const groundPts = trackPts.filter(p => !p.bridge);
        const { xMin, xMax, zMin, zMax } = trackBounds(trackPts, barrierDist);

        for (let i = 0; i < NATURE_ATTEMPTS; i++) {
            const x = xMin + rng() * (xMax - xMin);
            const z = zMin + rng() * (zMax - zMin);

            const dTrack = TrackGeometry.nearestPoint(trackPts, x, z);
            if (dTrack.dist < barrierDist + NATURE_MIN_MARGIN) continue;
            if (dTrack.dist > barrierDist + NATURE_MAX_MARGIN) continue;
            if (TrackGeometry.nearestPoint(pitPts, x, z).dist < pitRoadHalf + PIT_NATURE_MARGIN) continue;
            if (insidePlayerBoxFootprint(x, z, playerBoxFootprints)) continue;
            if (isTooCloseToAny(accepted, x, z, NATURE_MIN_SPACING)) continue;

            const asset = weightedPick(rng, NATURE_ASSETS);
            // La quota è la somma di DUE rilievi disgiunti, esattamente come la
            // calcola trackMeshBuilder.buildGround, che è il terreno vero:
            // il terrapieno vale entro embankOuter, le colline solo oltre
            // embankOuter + HILL_START_MARGIN.
            //
            // La distanza per le colline si misura sui punti A TERRA, non su
            // tutti: vicino a un ponte un albero può essere a 85 unità dal
            // tracciato sopraelevato e a 145 dal tracciato a terra, e il
            // terreno sotto di lui segue la seconda. Con il solo terrapieno
            // quell'albero restava a quota zero mentre il suolo gli saliva
            // sotto, cioè sepolto — difetto latente emerso avvicinando le
            // colline il 2026-08-10.
            const dGround = TrackGeometry.nearestPoint(groundPts, x, z).dist;
            const y = TrackGeometry.terrainHeightAt(groundPts, x, z, barrierDist, embankOuter)
                    + SceneryHills.hillHeightAt(x, z, dGround, embankOuter,
                                               TrackGeometry.isInsideLoop(groundPts, x, z));
            if (!fitsUnderBridge(asset, x, z, y)) continue;
            const point = { asset, category: 'nature', x, y, z, rotY: rng() * Math.PI * 2, scale: NATURE_SCALE[asset] };
            layout.push(point);
            accepted.push(point);
        }
        return layout;
    }

    // Alberi fitti sulle colline e sulla fascia che le precede: è ciò che
    // chiude l'orizzonte, insieme al rilievo del terreno. La quota viene da
    // SceneryHills, LO STESSO modulo che genera la mesh del terreno in
    // trackMeshBuilder: se le due quote divergessero, gli alberi
    // risulterebbero sepolti o sospesi in aria.
    // Fondale lontano: blocchi di foresta al posto di migliaia di alberi
    // singoli. Vedi il commento su MASS_MIN_MARGIN per il perché.
    //
    // Non passano da `accepted`: sono a 300+ unità dalla pista, dove non c'è
    // nient'altro con cui possano scontrarsi, e confrontarle con ~1500 voci
    // costerebbe più di quanto valga. Si controllano solo fra loro.
    function buildWoodMassLayout(rng, trackPts, barrierDist, embankOuter) {
        const layout = [];
        const groundPts = trackPts.filter(p => !p.bridge);
        const { xMin, xMax, zMin, zMax } = trackBounds(trackPts, barrierDist + MASS_MAX_MARGIN);

        for (let i = 0; i < MASS_ATTEMPTS && layout.length < MASS_MAX_COUNT; i++) {
            const x = xMin + rng() * (xMax - xMin);
            const z = zMin + rng() * (zMax - zMin);
            const d = TrackGeometry.nearestPoint(groundPts, x, z).dist;
            if (d < barrierDist + MASS_MIN_MARGIN) continue;
            if (d > barrierDist + MASS_MAX_MARGIN) continue;
            // Mai dentro l'anello: l'infield resta libero, e una macchia larga
            // 75 in mezzo al circuito si vedrebbe da ogni punto della pista.
            if (TrackGeometry.isInsideLoop(groundPts, x, z)) continue;

            let tropoVicina = false;
            for (const m of layout) {
                if (Math.hypot(m.x - x, m.z - z) < MASS_MIN_SPACING) { tropoVicina = true; break; }
            }
            if (tropoVicina) continue;

            layout.push({
                asset: 'woodMass', category: 'woodmass', x,
                y: SceneryHills.hillHeightAt(x, z, d, embankOuter, false),
                z,
                // Solo quattro orientamenti: la macchia è quasi quadrata in
                // pianta e ruotarla di angoli qualsiasi non aggiunge varietà
                // visibile, mentre allineare i blocchi a 90° li fa combaciare
                // meglio quando due macchie si toccano.
                rotY: Math.floor(rng() * 4) * (Math.PI / 2),
                scale: CUSTOM_MODEL_SCALE,
            });
        }
        return layout;
    }

    function buildWoodsLayout(rng, trackPts, barrierDist, embankOuter, accepted, fitsUnderBridge) {
        const layout = [];
        const groundPts = trackPts.filter(p => !p.bridge);
        const outer = embankOuter + SceneryHills.HILL_START_MARGIN + SceneryHills.HILL_RAMP;
        const { xMin, xMax, zMin, zMax } = trackBounds(trackPts, outer);

        for (let c = 0; c < WOOD_CLUSTERS && layout.length < WOOD_MAX_TREES; c++) {
            const cxp = xMin + rng() * (xMax - xMin);
            const czp = zMin + rng() * (zMax - zMin);
            // Il centro della macchia deve cadere fuori dalla fascia di uscita
            // di pista: le macchie estratte troppo vicine si scartano invece
            // di spostarle, così la distribuzione resta uniforme.
            if (TrackGeometry.nearestPoint(groundPts, cxp, czp).dist < embankOuter + WOOD_MIN_MARGIN) continue;

            for (let k = 0; k < WOOD_PER_CLUSTER && layout.length < WOOD_MAX_TREES; k++) {
                const a = rng() * Math.PI * 2;
                const r = Math.sqrt(rng()) * WOOD_CLUSTER_RADIUS;   // sqrt: distribuzione uniforme sul disco
                const x = cxp + Math.cos(a) * r, z = czp + Math.sin(a) * r;
                const d = TrackGeometry.nearestPoint(groundPts, x, z).dist;
                if (d < embankOuter + WOOD_MIN_MARGIN) continue;
                if (isTooCloseToAny(accepted, x, z, WOOD_MIN_SPACING)) continue;

                const asset = weightedPick(rng, NATURE_ASSETS);
                const y = SceneryHills.hillHeightAt(x, z, d, embankOuter,
                                                   TrackGeometry.isInsideLoop(groundPts, x, z));
                // I ponti valgono anche qui. Il controllo mancava perché i
                // boschi nascevano lontani dal tracciato, dove ponti non ce ne
                // sono: avvicinando le colline il 2026-08-10 un albero di
                // bosco in quota ha cominciato ad attraversare un impalcato
                // (misurato: chioma a 32.4 contro un ponte a 2.3).
                if (!fitsUnderBridge(asset, x, z, y)) continue;
                // Categoria propria e non 'nature': gli alberi dei boschi
                // prendono la quota dalle COLLINE, non dal terrapieno, e i
                // controlli sulla natura (quota entro il terrapieno, distanza
                // dalla corsia box) non li descrivono.
                const tree = { asset, category: 'woods', x, y, z,
                               rotY: rng() * Math.PI * 2, scale: NATURE_SCALE[asset] };
                layout.push(tree);
                accepted.push(tree);
            }
        }
        return layout;
    }

    // Tentativo singolo (non garantito) di piazzare un laghetto: cerca un
    // punto con un raggio libero sufficiente attorno; se non lo trova entro
    // il budget di tentativi, nessun laghetto su questo tracciato.
    function findPondSpot(rng, trackPts, pitPts, barrierDist, pitRoadHalf, accepted, embankOuter, playerBoxFootprints) {
        const groundPts = trackPts.filter(p => !p.bridge);
        const { xMin, xMax, zMin, zMax } = trackBounds(trackPts, barrierDist);

        for (let i = 0; i < POND_ATTEMPTS; i++) {
            const x = xMin + rng() * (xMax - xMin);
            const z = zMin + rng() * (zMax - zMin);

            const dTrack = TrackGeometry.nearestPoint(trackPts, x, z);
            if (dTrack.dist < barrierDist + NATURE_MIN_MARGIN + POND_RADIUS) continue;
            if (dTrack.dist > barrierDist + NATURE_MAX_MARGIN) continue;
            if (TrackGeometry.nearestPoint(pitPts, x, z).dist < pitRoadHalf + PIT_NATURE_MARGIN + POND_RADIUS) continue;
            if (insidePlayerBoxFootprint(x, z, playerBoxFootprints)) continue;
            if (isTooCloseToAny(accepted, x, z, POND_CLEARANCE)) continue;

            const y = TrackGeometry.terrainHeightAt(groundPts, x, z, barrierDist, embankOuter);
            return { category: 'pond', x, y, z, radius: POND_RADIUS };
        }
        return null;
    }

    // trackData: JSON del tracciato (serve trackData.id per il seed e
    // trackData.pit.roadHalfWidth). trackPts/pitPts: punti già campionati
    // (TrackGeometry.sampleLoop/sampleOpenPath), stessi usati da
    // TrackMeshBuilder. barrierDist: distanza barriera dal centro pista
    // (BARRIER_D in f1.js).
    // embankmentWidth: ampiezza del terrapieno oltre barrierDist entro cui la
    // quota sfuma a 0 (vedi TrackGeometry.terrainHeightAt) — default 45,
    // stesso valore usato in frontend/f1.js per la mesh del terrapieno
    // stesso: se in futuro si tara diversamente in f1.js, va passato qui
    // esplicitamente per restare coerenti.
    // seatAnchors (opzionale): posti a sedere delle tribune, letti da f1.js
    // da frontend/assets/custom/circuit/grandStandSeats.json. Omesso, il
    // layout viene generato senza spettatori — così i test e gli altri
    // chiamanti che non ne hanno bisogno continuano a funzionare con 4-5
    // argomenti.
    function generateLayout(trackData, trackPts, pitPts, barrierDist, embankmentWidth = 45, seatAnchors = null) {
        const rng = mulberry32(hashString(trackData.id));
        const pitRoadHalf = trackData.pit.roadHalfWidth;
        const side = mainStandSide(trackPts, pitPts);
        const embankOuter = barrierDist + embankmentWidth;
        // Ingombro reale di ciascun box giocatore (caso peggiore,
        // PLAYER_BOX_MAX_COUNT box pieni — vedi commento sopra): calcolato
        // una volta qui, riusato per escludere paddock/natura/laghetto da
        // tutta la fila reale, non solo dal punto centrale pitBoxIndex.
        const boxAnchors = TrackGeometry.pitBoxAnchors(trackData.pit.path, trackData.pit.boxIndex, PLAYER_BOX_MAX_COUNT);
        // Due poligoni per box: il garage e il grembiule di manovra davanti.
        // insidePlayerBoxFootprint li tratta indifferentemente, è già una
        // lista di poligoni.
        const playerBoxFootprints = [];
        for (const a of boxAnchors) {
            playerBoxFootprints.push(playerBoxFootprintCorners(a, trackPts, pitRoadHalf));
            playerBoxFootprints.push(playerBoxApronCorners(a, trackPts, pitRoadHalf));
        }

        // Filtro anti-cavalcavia: scarta gli oggetti troppo alti per stare
        // sotto un tratto di pista sopraelevata che passa lì sopra.
        const fitsUnderBridge = makeBridgeFilter(trackPts, barrierDist);


        const paddock   = buildPaddockLayout(trackPts, pitPts, barrierDist, pitRoadHalf, side, embankOuter, playerBoxFootprints, fitsUnderBridge);
        const mainStand = buildMainGrandstandLayout(trackPts, barrierDist, side, embankOuter, fitsUnderBridge);
        const accepted  = [...paddock, ...mainStand];
        const grandstand = buildGrandstandLayout(trackPts, pitPts, barrierDist, pitRoadHalf, accepted, rng, embankOuter, fitsUnderBridge, mainStand);

        // Landmark (torre, ponte semafori, podio, passerella): calcolati
        // prima della natura, così lo scatter degli alberi li vede fra gli
        // oggetti già accettati e non ci finisce sopra.
        const landmarks = SceneryLandmarks.buildLandmarks(
            trackPts, pitPts, barrierDist, side, embankOuter,
            playerBoxFootprints, insidePlayerBoxFootprint, fitsUnderBridge, pitRoadHalf,
            accepted);
        accepted.push(...landmarks);

        // Elementi distribuiti in base alla curvatura (gomme, cartelli di
        // frenata, commissari, reti, barriere di cemento, decoro paddock).
        const trackside = SceneryTrackside.buildTrackside({
            trackPts, pitPts, barrierDist, pitRoadHalf, embankOuter, mainSide: side, rng,
            playerBoxFootprints, insidePlayerBoxFootprint, fitsUnderBridge,
            grandstands: [...mainStand, ...grandstand],
        });

        // Spettatori sulle tribune già piazzate. seatAnchors arriva da
        // f1.js (fetch di grandStandSeats.json): questo modulo è puro e non
        // accede alla rete. Se manca, si generano tribune vuote invece di
        // far fallire il caricamento della pista.
        const crowd = SceneryCrowd.buildCrowd([...mainStand, ...grandstand], seatAnchors, rng);

        const nature = buildNatureLayout(rng, trackPts, pitPts, barrierDist, pitRoadHalf, accepted, embankOuter, playerBoxFootprints, fitsUnderBridge);
        // Boschi DOPO la natura: le macchie vedono fra gli oggetti già
        // accettati anche gli alberi vicini alla pista, e non ci finiscono
        // sopra.
        const woods  = buildWoodsLayout(rng, trackPts, barrierDist, embankOuter, accepted, fitsUnderBridge);
        const masse  = buildWoodMassLayout(rng, trackPts, barrierDist, embankOuter);
        const pond   = findPondSpot(rng, trackPts, pitPts, barrierDist, pitRoadHalf, accepted, embankOuter, playerBoxFootprints);

        const layout = [...paddock, ...mainStand, ...grandstand, ...landmarks,
                        ...trackside, ...crowd, ...nature, ...woods, ...masse];
        if (pond) layout.push(pond);
        return layout;
    }

    return {
        generateLayout, hashString, mulberry32, PIT_BUILDING_OFFSET_MARGIN,
        playerBoxFootprintCorners, playerBoxApronCorners,
        insidePlayerBoxFootprint, PLAYER_BOX_MAX_COUNT,
        PLAYER_BOX_OFFSET_MARGIN, PLAYER_BOX_LOCAL_BOUNDS
    };
});
