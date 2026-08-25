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
                                 require('./sceneryAssetSizes.js'), require('./sceneryHills.js'),
                                 require('./sceneryPaddock.js'), require('./trackGravel.js'),
                                 require('./sceneryInfrastructure.js'),
                                 require('./sceneryRegistro.js'),
                                 require('./sceneryEsclusioni.js'));
    } else {
        root.TrackScenery = factory(root.TrackGeometry, root.SceneryLandmarks,
                                    root.SceneryTrackside, root.SceneryCrowd,
                                    root.SceneryAssetSizes, root.SceneryHills,
                                    root.SceneryPaddock, root.TrackGravel,
                                    root.SceneryInfrastructure,
                                    root.SceneryRegistro, root.SceneryEsclusioni);
    }
})(typeof self !== 'undefined' ? self : this, function (TrackGeometry, SceneryLandmarks,
                                                        SceneryTrackside, SceneryCrowd,
                                                        SceneryAssetSizes, SceneryHills,
                                                        SceneryPaddock, TrackGravel,
                                                        SceneryInfrastructure,
                                                        SceneryRegistro, SceneryEsclusioni) {

    // Le categorie senza un modello solido: superfici piane e folla, che non
    // hanno un ingombro da far rispettare a nessuno. La folla in particolare
    // sono ~6500 voci su 7667, tutte dentro le tribune per costruzione: farle
    // passare dalla porta vorrebbe dire scartarle tutte.
    const SENZA_INGOMBRO = new Set(['pond', 'parkingLot', 'crowd']);

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

    // Vegetazione della fascia vicina. I due Kenney restano accanto ai voxel
    // nuovi con peso basso: la decisione se tenerli si prende guardando, non a
    // priori (scelta dell'utente 2026-08-10), ma nel frattempo devono essere
    // minoranza — sono di un'altra mano e alti la metà.
    const NATURE_ASSETS = [
        { asset: 'treeBroad', weight: 2.5, scale: CUSTOM_MODEL_SCALE },
        { asset: 'treeYoung', weight: 2.0, scale: CUSTOM_MODEL_SCALE },
        { asset: 'treeRound', weight: 2.5, scale: CUSTOM_MODEL_SCALE },
    ];

    // I boschi vogliono ALTEZZA, non varietà: il pino (16.6, quasi il doppio
    // del Kenney più grande) domina, gli altri due rompono la regolarità. I
    // cespugli non ci vanno: a quella distanza non si vedrebbero comunque e
    // costerebbero istanze.
    const WOOD_ASSETS = [
        { asset: 'treePine',  weight: 4.0, scale: CUSTOM_MODEL_SCALE },
        { asset: 'treeBroad', weight: 2.0, scale: CUSTOM_MODEL_SCALE },
        { asset: 'treeYoung', weight: 1.0, scale: CUSTOM_MODEL_SCALE },
    ];

    // Rocce: variano il materiale, non solo la sagoma. Stanno lontane dalla
    // pista per scelta esplicita dell'utente — quella fascia diventerà via di
    // fuga in ghiaia, e un masso a bordo pista si legge come un ostacolo
    // pericoloso anche se non lo è.
    const ROCK_ASSETS = [
        { asset: 'rockSingle',  weight: 3, scale: CUSTOM_MODEL_SCALE },
        { asset: 'rockCluster', weight: 1, scale: CUSTOM_MODEL_SCALE },
    ];
    // Il fattore che aggancia le quantita' sparse alla lunghezza del giro.
    //
    // 3250 sta appena sopra melbourne (3182) e new-monza (3205): le due piste
    // col vuoto quasi nullo, la densita' che l'utente ha approvato. Sotto
    // quella lunghezza vale 1, e le piste gia' cotte non cambiano di un oggetto
    // — con 3200 new-monza ne guadagnava UNO e andava ricotta per niente — e' la regola che tiene
    // basso il rischio: **i tetti si alzano, mai si abbassano**.
    //
    // ⚠️ CODA APERTA (2026-08-25, scelta dell'utente: si procede cosi' e si
    // rivede in futuro). Per gli scatter il fattore giusto sarebbe l'AREA, non
    // il giro: sono estrazioni uniformi dentro `trackBounds`, e una pista puo'
    // essere lunga ma compatta. `nuova-pista` fa 4389 di giro dentro un'area
    // piu' PICCOLA di melbourne (660k contro 755k) perche' serpeggia, e ha gia'
    // piu' alberi per unita' d'area (0.65 contro 0.57): con questo fattore ne
    // riceve un 37% che non le serve. Sulle tribune invece il giro e' la
    // misura giusta, e li' resta.
    const GIRO_RIFERIMENTO = 3250;
    function fattoreGiro(lapLen) {
        return Math.max(1, lapLen / GIRO_RIFERIMENTO);
    }

    const ROCK_ATTEMPTS    = 220;
    const ROCK_MIN_MARGIN  = 60;   // oltre barrierDist: fuori dalla fascia della ghiaia
    const ROCK_MAX_MARGIN  = 330;  // arriva sui primi pendii collinari
    const ROCK_MIN_SPACING = 26;   // sparse, non a tappeto

    const NATURE_SCALE = Object.fromEntries(
        [...NATURE_ASSETS, ...WOOD_ASSETS, ...ROCK_ASSETS].map(a => [a.asset, a.scale])
    );

    // Scatter natura, valori originali. Un tentativo di allargare la fascia
    // a 200 unità per riempire l'orizzonte è stato annullato: portava gli
    // alberi da ~230 a oltre 700 e faceva scattare il gioco anche in
    // localhost, senza peraltro togliere la sensazione di prato infinito
    // (quella dipende dal terreno piatto, non dal numero di alberi).
    const NATURE_ATTEMPTS     = 300;  // candidati casuali provati per lo scatter natura
    const NATURE_MIN_MARGIN   = 12;   // oltre barrierDist: distanza minima dalla pista
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
    const WOOD_CLUSTERS       = 60;   // macchie tentate per tracciato
    // 20 e non 16: il tetto di WOOD_MAX_TREES viene raggiunto comunque, quindi
    // alzare questo numero NON aggiunge alberi — cambia soltanto in quante
    // macchie si spalmano gli stessi 430, e macchie più piene sono più fitte.
    // Con 16 la densità misurata era 2.96-3.33 vicini su TUTTI E QUATTRO i
    // tracciati, cioè appena sopra la soglia di 3 sotto la quale il bosco si
    // legge come prato spennacchiato: qualunque metro quadro sottratto la
    // faceva sprofondare, ed è ciò che è successo quando il tratto 558-614 di
    // `prova` ha smesso di essere marcato `bridge` (2.96). Con 20 si sta fra
    // 3.53 e 3.71, con margine.
    const WOOD_PER_CLUSTER    = 20;   // alberi tentati per macchia
    // Raggio STRETTO di proposito: allargarlo dirada la macchia invece di
    // ingrandirla, e un bosco rado non ferma lo sguardo. La massa visiva viene
    // dalla densità interna, non dall area coperta.
    const WOOD_CLUSTER_RADIUS = 30;
    const WOOD_MIN_SPACING    = 5;
    // Tetto complessivo, sopra i ~240 alberi di NATURE_*: a 700 totali il
    // gioco scattava anche in localhost (vedi il commento di NATURE_ATTEMPTS).
    // Da allora gli alberi sono esclusi dalle ombre, che di quel calo erano la
    // causa vera, ma il tetto resta esplicito e ritarabile.
    const WOOD_MAX_TREES      = 430;
    // Margine oltre il bordo del terrapieno entro cui NON si pianta: è la
    // fascia dove si finisce uscendo di pista, deve restare sgombra.
    const WOOD_MIN_MARGIN     = 20;

    // TENTATIVO ARCHIVIATO (2026-08-10): macchie di bosco come fondale.
    //
    // L'idea: un blocco largo 75 al posto di trenta alberi, per riempire
    // l'orizzonte con 170 istanze invece delle ~4500 che servirebbero con
    // alberi larghi 2.1 (a 500 unità un albero copre 0.24 gradi, una macchia
    // 8.6). Il conto era giusto e le prestazioni ottime.
    //
    // Il risultato no: un blocco squadrato a quella distanza si legge come una
    // scatola verde, e appoggiato ai gradoni delle colline peggiorava le cose
    // invece di migliorarle. L'utente l'ha visto e ha chiesto di toglierlo.
    //
    // L'asset resta in `frontend/assets/custom/circuit/woodMass.glb` col suo
    // builder in `circuitAssets/vegetation.py`. Se si riprende, il lavoro da
    // fare è sulla FORMA — silhouette irregolare, chiome tondeggianti, bordi
    // frastagliati, mai un parallelepipedo — non sul piazzamento, che
    // funzionava: stava oltre 300 unità dalla pista, mai nell'infield, con le
    // macchie che si toccavano fra loro.

    // Ritarati il 2026-08-09 sui modelli voxel custom, ~3 volte più grandi
    // dei Kenney che sostituiscono (tribuna: da 6.0×5.38 a 19.2×12.3).
    const GRANDSTAND_OFFSET_MARGIN = 10; // era 6: la tribuna è profonda 12.8, mezza profondità 6.4
    const GRANDSTAND_PIT_MARGIN    = 24; // era 20: mezza diagonale della tribuna nuova
    // Le 3 varianti a 1 piano: grandStandCoveredRound/grandStandRound sono
    // escluse a priori (footprint circolare 1.64x1.64 contro 1.00x1.00 delle
    // altre — non affiancabili a un bordo dritto, verificato con un render di
    // confronto durante il brainstorming).
    const STAND_VARIANTS = ['grandStand', 'grandStandAwning', 'grandStandCovered'];

    // Palette delle infrastrutture distribuite. Dentro ogni contesto l'ordine
    // è l'ordine di PREFERENZA: se il primo non entra si prova il successivo,
    // invece di lasciare un buco.
    //
    // ⚠️ SOLO i modelli nuovi. Il 2026-08-13 ci avevo messo `pylon`,
    // `flagPole` e `billboardLow` per giudicare la distribuzione prima di
    // modellare, e il playtest l'ha bocciata: «non hai riempito niente, hai
    // solo inserito cartelloni in posti sbagliati». Riempire un circuito vuole
    // VOLUMI. La segnaletica non torna qui nemmeno come ripiego.
    //
    // `passoMinimo` è la distanza minima in unità fra due esemplari dello
    // stesso asset: è ciò che distingue "distribuito" da "ammucchiato", e vale
    // per famiglia perché due gru vicine sono una stonatura mentre una gru e
    // una torretta TV vicine no.
    //
    // ⚠️ Dal 2026-08-16 si misura LUNGO LA PISTA e non più in linea d'aria
    // (vedi sceneryInfrastructure.js), quindi a parità di numero è più severo:
    // due rami del giro che si sfiorano non si tolgono più il posto, ma un
    // tratto non può nemmeno riempirsi meglio del passo più corto fra i suoi
    // candidati. Ne segue una regola per tarare questi numeri: **il vuoto
    // peggiore di un contesto vale quanto il passoMinimo più piccolo che quel
    // contesto ammette**. Su `new-monza` il tetto del test è 110 e il vuoto
    // misurato era 157, cioè i 155 di `hospitalityDeck`.
    const PALETTE_INFRASTRUTTURE = [
        // Esterno curva: è il contesto che la spec voleva servire per primo,
        // ed è raro (6-10% del giro). Gli asset che ci vanno sono quelli che
        // "guardano" la curva.
        { asset: 'recoveryCrane',   contesti: ['curvaEsterno'],                     passoMinimo: 260 },
        { asset: 'tvTower',         contesti: ['curvaEsterno', 'viadotto'],         passoMinimo: 300 },
        // 100 e non 155: è il passo più corto del contesto `aperto`, quindi è
        // lui a fissare il vuoto peggiore dove non c'è altro. A 155 restavano
        // 157 unità spoglie su new-monza, a 120 ne restano 106 — quattro sotto
        // il tetto, troppo poco margine — a 100 ne restano 80.
        { asset: 'hospitalityDeck', contesti: ['curvaEsterno', 'aperto'],           passoMinimo: 100 },
        { asset: 'vipSuite',        contesti: ['curvaEsterno', 'aperto'],           passoMinimo: 520 },
        // Visuale lunga: il maxischermo va visto da lontano, e uno solo per
        // volta — 700 unità su un giro di 5170 vuol dire al più sette.
        { asset: 'giantScreen',     contesti: ['rettilineo', 'viadotto'],           passoMinimo: 700 },
        { asset: 'serviceBuilding', contesti: ['rettilineo', 'aperto'],             passoMinimo: 270 },
        { asset: 'floodlightTower', contesti: ['viadotto', 'rettilineo', 'aperto'], passoMinimo: 185 },
        // ⚠️ `trackGate` NON è distribuito, per decisione dell'utente al
        // playtest del 2026-08-14: «i nuovi cancelli non hanno motivo di essere
        // distribuiti in giro per la pista». Un cancello è un varco di
        // servizio, e ha senso dove si entra davvero — non ogni 220 unità
        // lungo il muro. Il modello resta in repo, caricato e misurato: se un
        // giorno servirà un accesso in un punto scelto, è già pronto.
        //
        // Conseguenza da tenere presente: il contesto `stretto` (18% del giro
        // su prova, 32% su monte-rosso) resta senza nessun candidato, e quei
        // tratti restano spogli. È una scelta, non una svista: nella palette
        // vanno volumi, e nessuno degli altri sette entra dove il muro della
        // via di fuga sta a 13-15.
    ];

    // Tribuna principale: unica per tracciato, vicino al rettilineo di
    // partenza. È la variante CON LA COPERTURA, mentre le schiere sparse per
    // il circuito pescano a caso fra le tre (richiesta dell'utente,
    // 2026-08-13): la tribuna del traguardo è quella importante, e il tetto
    // la distingue da lontano. Con MAIN_STAND_TIERS = 1 non c'è più il
    // vincolo dell'impilamento che imponeva 'grandStand' — restava documentato
    // che 'grandStandAwning' impilata rompe la tribuna sopra (il telo sporge
    // oltre il modulo) mentre tetto piatto e nessun tetto si impilano puliti.
    const MAIN_STAND_ASSET         = 'grandStandCovered';
    // La fila unica e lunga che segue la pista senza interruzioni è una
    // richiesta vecchia dell'utente (playtest 2026-08-09 — "non voglio un
    // buco, voglio grandstand continui che seguono l'andamento della pista").
    // 12 e non 7. A 7 la fila finiva ~28 unità dopo il traguardo, cioè PRIMA
    // del ponte semafori (che sta GANTRY_AHEAD_OF_GRID = 75 avanti), e fra la
    // sua coda e la prima schiera secondaria restava un vuoto di 72 unità
    // proprio nel punto più guardato del circuito: segnalazione M 20 del
    // 2026-08-13, "lungo il traguardo non c'è una schiera unica".
    // A 12 la fila è lunga ~210 unità e copre tutto il rettilineo, ponte
    // semafori incluso. Non si allunga a piacere: si ferma da sola sui
    // viadotti, sulla corsia box e sugli ingombri già accettati (vedi
    // buildMainGrandstandLayout).
    const MAIN_STAND_COLS          = 12;
    // Quanti dei 12 moduli stanno OLTRE il traguardo, nel verso di marcia.
    // Cinque avanti (96 unità, il ponte semafori è a 75) e sei indietro, lungo
    // la griglia, che è dove il pubblico ha qualcosa da guardare. La
    // ripartizione non è simmetrica apposta: davanti serve solo arrivare oltre
    // il ponte, dietro c'è tutta la griglia di partenza.
    const MAIN_STAND_COLS_AVANTI   = 5;
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
    // 8 e non 6: allungare le schiere è l'unico modo di infittire i circuiti
    // CORTI, dove il numero di schiere è già al suo pavimento (monte-rosso
    // passa così da 41 a 50 tribune, mentre alzando il tetto delle schiere non
    // cambiava di una). Una schiera si dimensiona comunque da sé e si ferma
    // dove non ci sta più.
    const ROW_MAX_COLS = 8;
    const ROW_MIN_COLS = 2;
    // Quanto due moduli della stessa schiera possono avvicinarsi rispetto alla
    // loro larghezza prima che la schiera si interrompa. 0.9 lascia passare le
    // distanze vere delle schiere sane (misurate 17.4-24.1) e taglia quelle
    // delle schiere accartocciate in curva (10.6-16.1).
    const ROW_MIN_SPACING_RATIO = 0.9;
    // Quante SCHIERE di tribune tentare lungo il giro: una ogni 220 unità.
    //
    // ⚠️ NIENTE TETTO, ed è una lezione pagata due volte. Era 10, poi 18
    // (2026-08-13, «vorrei vederlo bello pieno»): tutte e due le volte bastava
    // per le piste di allora e cadeva sulla prima pista più lunga. Su shanghai
    // (giro 7485) la formula ne chiedeva 34 e il tetto ne lasciava passare 18
    // — una schiera ogni 416 unità, metà della densità di melbourne, ed è il
    // «in proporzione il circuito è più vuoto» segnalato dall'utente il
    // 2026-08-25. Un tetto assoluto su una quantità distribuita lungo il giro
    // descrive densità diverse su piste diverse: va tolto come concetto, non
    // ritoccato come numero.
    // Rif. docs/superpowers/specs/2026-08-25-f1-densita-scenografia-design.md
    //
    // Il PAVIMENTO invece resta, e conta sui circuiti corti: su monte-rosso
    // (1177) la formula chiede 5. Lì la densità cresce allungando le schiere
    // (ROW_MAX_COLS), non moltiplicandole.
    const SCHIERA_OGNI  = 220;
    const SCHIERE_MINIME = 6;
    function schiereDaTentare(lapLen) {
        return Math.max(SCHIERE_MINIME, Math.round(lapLen / SCHIERA_OGNI));
    }
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
    const MAIN_STAND_TIER_HEIGHT   = SceneryAssetSizes.sizeOf(MAIN_STAND_ASSET).h;
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
    // Quanto un edificio del fronte box deve stare libero dalla corsia, e di
    // quanto puo' scostarsi verso l'esterno per riuscirci. Vedi il commento
    // nel ciclo che li posa: dove la corsia rientra su se stessa, l'offset
    // nominale non basta.
    const PIT_BUILDING_LANE_CLEARANCE = 2;
    const PIT_BUILDING_LANE_PUSH_MAX = 24;
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
    // Misurato sul .glb reale: dal 2026-08-17 il box è largo 14.1 (era 21.8),
    // stretto insieme al passo della corsia sceso da 24 a 15 per far stare
    // fino a 20 piloti. La PROFONDITÀ non è cambiata.
    const PLAYER_BOX_LOCAL_BOUNDS = { xMin: -7.05, xMax: 7.05, zMin: -11, zMax: 11 };
    // DEVE restare uguale a PitBoxLoader.PIT_BOX_OFFSET_MARGIN, altrimenti la
    // scenografia esclude una zona diversa da quella dove i box vengono
    // davvero piazzati. Era già successo: quando PIT_BOX_CLEARANCE passò da 2
    // a 12 questo valore restò a 13.2 contro i 23.2 del loader, cioè la zona
    // protetta era 10 unità fuori posto. Ora un test in trackScenery.test.js
    // confronta le due costanti e fallisce se divergono.
    const PLAYER_BOX_OFFSET_MARGIN = 23;
    // Un po' di respiro visivo oltre il vero muro del box, per non far
    // spuntare un albero/cartellone letteralmente a contatto.
    //
    // 1 e non più 3: col passo della corsia sceso a 15 e i box larghi 14.1,
    // fra un box e il suo vicino di fronte restano 0.9 unità per lato. Un
    // margine di 3 dichiarava occupato lo spazio del vicino, e nel fronte
    // continuo il vicino c'è per progetto — è un garage, non un albero
    // cresciuto lì per caso.
    const PLAYER_BOX_CLEARANCE = 1;
    // Numero di piloti usato quando il chiamante non lo dice (test storici,
    // editor). Non è più il "caso peggiore" da riservare comunque: la
    // scenografia riceve il numero VERO in `opzioni.gridSize`, perché arriva
    // dalla lobby prima che la pista si carichi. Il commento che stava qui
    // dichiarava l'opposto — "PRIMA di sapere quanti giocatori
    // parteciperanno" — ed era la ragione per cui, con pochi piloti, restava
    // corsia box vuota.
    const PLAYER_BOX_MAX_COUNT = 6;
    // Mezzo passo: soglia per riconoscere che un'ancora di box e una posizione
    // della griglia sono LO STESSO posto. Non si confronta l'uguaglianza
    // esatta perché le due passano da percorsi di calcolo diversi.
    const PIT_BOX_SPACING_HALF = TrackGeometry.PIT_BOX_SPACING / 2;

    // Angoli mondo dell'ingombro del box giocatore per un dato anchor —
    // stessa trasformazione di pitBoxLoader.js::loadPitBoxModel
    // (rotazione -90° perché l'apertura è modellata lungo +X locale, non
    // +Z), con PLAYER_BOX_CLEARANCE di margine extra su tutti i lati.
    // `margine`: quanto allargare l'ingombro oltre il muro del box. Il valore
    // predefinito serve a tenere lontani alberi e cartelloni; chi costruisce
    // il FRONTE della corsia passa 0, perché lì il vicino è un garage messo
    // apposta a fianco e il margine gli negherebbe il posto.
    function playerBoxFootprintCorners(anchor, trackPts, pitRoadHalf, margine) {
        const nx = -anchor.tz, nz = anchor.tx;
        const distPlus  = TrackGeometry.nearestPoint(trackPts, anchor.x + nx, anchor.z + nz).dist;
        const distMinus = TrackGeometry.nearestPoint(trackPts, anchor.x - nx, anchor.z - nz).dist;
        const side = distPlus >= distMinus ? 1 : -1;
        const offset = pitRoadHalf + PLAYER_BOX_OFFSET_MARGIN;
        const bx = anchor.x + nx * offset * side, bz = anchor.z + nz * offset * side;
        const rotY = Math.atan2(anchor.x - bx, anchor.z - bz);

        const theta = rotY - Math.PI / 2;
        const cos = Math.cos(theta), sin = Math.sin(theta);
        const c = margine != null ? margine : PLAYER_BOX_CLEARANCE;
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
    // Distanza dal bordo di un poligono.
    function distanzaDalPoligono(x, z, poly) {
        let minima = Infinity;
        for (let i = 0; i < poly.length; i++) {
            const a = poly[i], b = poly[(i + 1) % poly.length];
            const dx = b.x - a.x, dz = b.z - a.z;
            const len2 = dx * dx + dz * dz;
            const t = len2 > 0
                ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2))
                : 0;
            const d = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
            if (d < minima) minima = d;
        }
        return minima;
    }

    // Come insidePlayerBoxFootprint, ma guardando l'INGOMBRO e non il solo
    // centro: un albero col tronco fuori dal grembiule di manovra ci arriva
    // comunque con la chioma, e in gara si vede un ramo dentro il box.
    //
    // È la stessa trappola documentata in docs/f1-notes.md per gli edifici
    // ("SAT sugli ANGOLI, non il centro"), qui rimasta aperta per natura e
    // rocce. È emersa quando i box si sono stretti da 21.8 a 14.1: lo spazio
    // liberato ha attirato uno scatter che prima cadeva altrove.
    //
    // Cerchio e non rettangolo orientato perché per una chioma o una roccia la
    // rotazione è casuale e ininfluente, e perché il cerchio scarta qualcosa in
    // più del necessario — il verso giusto in cui sbagliare quando si protegge
    // lo spazio in cui una macchina manovra.
    function ingombroInvadeBox(asset, x, z, footprints, scala) {
        if (insidePlayerBoxFootprint(x, z, footprints)) return true;
        const dim = SceneryAssetSizes.sizeOf(asset);
        if (!dim) return false;
        const raggio = Math.hypot(dim.w, dim.d) / 2 * (scala || 1);
        return footprints.some(poly => distanzaDalPoligono(x, z, poly) < raggio);
    }

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
    function buildPaddockLayout(trackPts, pitPts, barrierDist, pitRoadHalf, mainSide, embankStart, embankOuter, playerBoxFootprints, fitsUnderBridge, boxCtx) {
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
                if (ingombroInvadeBox(asset, x, z, playerBoxFootprints)) continue;

                const rotY = Math.atan2(p.x - x, p.z - z);
                const y = TrackGeometry.terrainHeightAt(groundPts, x, z, embankStart, embankOuter);
                if (!fitsUnderBridge(asset, x, z, y)) continue;
                layout.push({ asset, category: 'paddock', x, y, z, rotY, scale: CUSTOM_MODEL_SCALE });
            }
        }

        // ── Il fronte della corsia: una fila sola ──
        //
        // Box dei piloti ed edifici decorativi si alternano sulle STESSE
        // posizioni (TrackGeometry.pitLaneSlots), a passo unico e in fase
        // unica. Prima erano due sistemi con passi diversi — 24 i box, ~22.65
        // la catena degli edifici, dettata dalle larghezze dei modelli — che
        // si evitavano a vicenda, e i vuoti nascevano da lì: su monte-rosso i
        // sei box occupavano tutti i campioni utili e gli edifici scendevano a
        // ZERO, mentre con pochi piloti restava corsia vuota.
        //
        // Ora, per costruzione: le posizioni riservate ai box sono quelle
        // centrali, tutte le altre prendono un edificio. Con un pilota c'è un
        // box e tutto il resto è fronte; con venti, venti box e il resto
        // fronte. Un vuoto può restare solo dove un controllo lo impone
        // (imbocco della corsia, cavalcavia), non per disallineamento.
        const slot = TrackGeometry.pitLaneSlots(boxCtx.pitPath, boxCtx.boxIndex,
                                                trackPts, pitRoadHalf);
        // Le posizioni dei box sono le stesse che sceglie pitBoxAnchors lato
        // server: si ricavano confrontando le coordinate invece di ricopiarne
        // la formula, così le due non possono divergere.
        const ancore = TrackGeometry.pitBoxAnchors(boxCtx.pitPath, boxCtx.boxIndex,
                                                   boxCtx.gridSize, trackPts, pitRoadHalf);
        const riservate = new Set();
        for (const a of ancore) {
            let migliore = -1, minima = Infinity;
            for (const s of slot) {
                const d = Math.hypot(s.x - a.x, s.z - a.z);
                if (d < minima) { minima = d; migliore = s.indice; }
            }
            if (migliore >= 0 && minima < PIT_BOX_SPACING_HALF) riservate.add(migliore);
        }

        // Poligoni dei box veri: un edificio non deve entrarci dentro. Sulle
        // curve la distanza fra i centri non basta a garantirlo, perché i due
        // volumi sono anche RUOTATI l'uno rispetto all'altro. Margine 0: nel
        // fronte continuo il vicino di un box è un garage messo apposta a
        // fianco, e il margine anti-albero gli negherebbe il posto.
        const poligoniBox = ancore.map(a => playerBoxFootprintCorners(a, trackPts, pitRoadHalf, 0));

        // Punto sul NASTRO degli edifici corrispondente a una posizione della
        // corsia. `verso` è il punto di corsia che l'edificio deve guardare.
        function puntoFronte(base) {
            const { nx, nz } = TrackGeometry.normalAt(pitPts, base.fromIdx, false);
            const p = pitPts[Math.min(base.fromIdx, pitPts.length - 1)];
            const distPlus = TrackGeometry.nearestPoint(trackPts, base.x + nx, base.z + nz).dist;
            const distMinus = TrackGeometry.nearestPoint(trackPts, base.x - nx, base.z - nz).dist;
            const side = distPlus >= distMinus ? 1 : -1;
            const off = pitRoadHalf + PIT_BUILDING_OFFSET_MARGIN;
            return {
                x: base.x + nx * off * side,
                z: base.z + nz * off * side,
                y: p.y || 0,
                verso: { x: base.x, z: base.z },
            };
        }

        const fronte = slot.map(puntoFronte);

        // Orientamento: perpendicolare al NASTRO su cui gli edifici sono
        // allineati, non diretto al punto di corsia.
        //
        // Le due direzioni coincidono in rettilineo e divergono in curva,
        // perché il nastro degli edifici corre 24 unità più in fuori e ha
        // quindi un raggio diverso. Puntando al punto di corsia gli edifici si
        // aprono a VENTAGLIO: i centri stanno alla distanza giusta ma i fronti
        // divergono, e fra l'uno e l'altro resta uno spicchio di vuoto —
        // segnalato in playtest su prova, "gli edifici sono orientati un
        // pochino male, soprattutto quelli presso l'entrata", che è dove la
        // corsia piega di più.
        function orientamento(k) {
            const a = fronte[Math.max(0, k - 1)];
            const b = fronte[Math.min(fronte.length - 1, k + 1)];
            let tx = b.x - a.x, tz = b.z - a.z;
            const len = Math.hypot(tx, tz);
            const q = fronte[k];
            if (len < 1e-9) return Math.atan2(q.verso.x - q.x, q.verso.z - q.z);
            tx /= len; tz /= len;
            let fx = -tz, fz = tx;
            if ((q.verso.x - q.x) * fx + (q.verso.z - q.z) * fz < 0) { fx = -fx; fz = -fz; }
            return Math.atan2(fx, fz);
        }

        function libero(cand, posati) {
            if (posati.some(q => SceneryAssetSizes.itemsOverlap(cand, q))) return false;
            const corners = SceneryAssetSizes.footprintCorners(cand);
            return !poligoniBox.some(poly => SceneryAssetSizes.polysOverlap(corners, poly));
        }

        let alternanza = 0;
        const posati = [];
        for (let k = 0; k < slot.length; k++) {
            const s = slot[k];
            if (riservate.has(s.indice)) continue;
            const asset = (alternanza % 2 === 0) ? 'pitsGarageClosed' : 'pitsOffice';
            const rotY = orientamento(k);

            // Dove la corsia piega molto due volumi affiancati si incrociano
            // comunque con gli spigoli: lì l'edificio si scosta di poco lungo
            // la corsia. Gli scarti piccoli (±1.5, ±3) sono stati provati e
            // danno un fronte PIÙ rado: per uscire dal cono del vicino serve
            // spostarsi di quasi mezzo passo.
            let cand = null;
            for (const scarto of [0, 2, -2, 4, -4, 6, -6]) {
                const base = scarto
                    ? TrackGeometry.pitSlotAt(boxCtx.pitPath, boxCtx.boxIndex, s.offset + scarto,
                                              trackPts, pitRoadHalf)
                    : s;
                const q = scarto ? puntoFronte(base) : fronte[k];
                const prova = {
                    asset, category: 'paddock', x: q.x, y: q.y, z: q.z,
                    rotY, scale: CUSTOM_MODEL_SCALE,
                    // Nato misurando la CORSIA, non la pista: traslaOltreLaGhiaia
                    // allontana dalla pista e della corsia non sa niente, quindi
                    // su melbourne spingeva questi edifici DENTRO la corsia (sei
                    // di loro, fino a 4.29 unità). Stessa ragione per cui le
                    // tribune portano `suMisuraSulMuro`.
                    natoSullaCorsia: true,
                };
                // Niente edifici all'IMBOCCO della corsia, dove corsia e pista
                // corrono ancora affiancate: lì un volume profondo 14.7 si
                // sovrappone all'ingresso e lo rende illeggibile (segnalato
                // dall'utente).
                if (TrackGeometry.nearestPoint(trackPts, prova.x, prova.z).dist
                        < barrierDist + PIT_BUILDING_TRACK_CLEARANCE) continue;
                // L'edificio deve stare fuori dalla CORSIA per intero, non solo
                // dal proprio tratto. Dove la corsia rientra su se stessa
                // (imbocco, uscita) un edificio a 24 unità dal suo tratto può
                // trovarsi addosso a un altro: misurato su melbourne, SEI
                // edifici fino a 4.29 unità DENTRO la corsia.
                //
                // Si SCOSTA verso l'esterno invece di essere scartato: un buco
                // nel fronte box si vede a colpo d'occhio, uno scalino di due
                // unità no. Scartarlo era la cura sbagliata per una fila.
                const versoFuori = Math.hypot(prova.x - q.verso.x, prova.z - q.verso.z) || 1;
                const ux = (prova.x - q.verso.x) / versoFuori, uz = (prova.z - q.verso.z) / versoFuori;
                let scostato = null;
                for (let extra = 0; extra <= PIT_BUILDING_LANE_PUSH_MAX; extra += 2) {
                    const t = Object.assign({}, prova, { x: prova.x + ux * extra, z: prova.z + uz * extra });
                    const vicino = Math.min(...SceneryAssetSizes.footprintCorners(t)
                        .map(c => TrackGeometry.nearestPoint(pitPts, c.x, c.z).dist));
                    if (vicino >= pitRoadHalf + PIT_BUILDING_LANE_CLEARANCE) { scostato = t; break; }
                }
                if (!scostato) continue;
                if (!fitsUnderBridge(asset, scostato.x, scostato.z, scostato.y)) continue;
                if (!libero(scostato, posati)) continue;
                cand = scostato;
                break;
            }
            if (!cand) continue;

            layout.push(cand);
            posati.push(cand);
            alternanza++;
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
    // Distanza a cui appoggiare una struttura che segue il bordo del circuito:
    // il muro dove il profilo c'è, la barriera storica dove non c'è (editor,
    // chiamanti vecchi). È il modo per far nascere le cose già al loro posto
    // invece di spostarle dopo.
    function distanzaDalMuro(barrierProfile, barrierDist, margine) {
        if (!barrierProfile) return barrierDist + margine;
        return (idx, side) => TrackGravel.barrierAt(barrierProfile, idx, side) + margine;
    }

    // Il muro PIÙ LONTANO sotto tutta la fila, cioè la distanza a cui si
    // allinea l'INTERA fila.
    //
    // Una fila che prende il muro modulo per modulo diventa una SCALA dove il
    // muro cambia: all'ingresso di una via di fuga passa da 15 a 30, e due
    // moduli consecutivi finiscono a quindici unità di distanza diversa dalla
    // pista (misurato: 14.8 su monte-rosso, 11.7 su prova). Una rete rigida
    // larga quanto la tribuna non può seguire una scala — o entra nella
    // tribuna vicina o entra nella ghiaia — e infatti veniva scartata,
    // lasciando tribune senza protezione. L'utente le ha viste in gioco tre
    // volte (segnalazioni M 16, 17, 18 del 2026-08-13) e ha scelto questa
    // strada: la fila è una linea di confine, dritta, come nei circuiti veri
    // dietro le vie di fuga.
    //
    // Conseguenza che rende tutto il resto facile: dentro una fila il
    // riferimento è UNO, quindi la rete davanti a ogni modulo sta a distanza
    // costante dalla sua tribuna e non può né entrarci né finire in ghiaia.
    // Aggiungere tribune diventa sicuro ovunque.
    //
    // ⚠️ Il vincolo «un modulo deve guardare la pista che ha davvero davanti»
    // vive in `TrackGeometry.guardaVersoLaPista`: è geometria pura e serve
    // anche a `sceneryInfrastructure.js`. La storia di come è nato — la fila
    // di 8 moduli con l'ottavo girato di 77° — sta nel commento lì.

    function muroDellaFila(trackPts, barrierProfile, barrierDist, moduli, side, mezzaInCampioni) {
        if (!barrierProfile) return barrierDist;
        const n = trackPts.length;
        let muro = barrierDist;
        for (const m of moduli) {
            // Tutto il FRONTE di ogni modulo, non il solo centro: il muro può
            // salire fra un campione e l'altro sotto la stessa tribuna.
            for (let s = -mezzaInCampioni; s <= mezzaInCampioni; s++) {
                const k = ((m.idx + s) % n + n) % n;
                muro = Math.max(muro, TrackGravel.barrierAt(barrierProfile, k, side));
            }
        }
        return muro;
    }

    // Una fila si costruisce DUE VOLTE: la prima con il muro modulo per modulo,
    // solo per sapere fin dove arriva; poi si prende il muro più lontano sotto
    // quella lunghezza e la si ricostruisce tutta a quella distanza.
    //
    // Non basterebbe guardare una finestra fissa attorno al seme: una fila si
    // dimensiona da sé (si ferma sui cavalcavia, sulla corsia box, sugli
    // ostacoli), e una finestra della lunghezza massima arretrerebbe anche le
    // file corte, che il problema non ce l'hanno.
    // Si itera fino al punto fisso, non una passata sola: arretrando, la fila
    // può trovare occupato un posto che alla distanza di prima era libero e
    // accorciarsi. Una fila più corta però attraversa meno muro, quindi il suo
    // massimo cala e può riallungarsi. Poche iterazioni bastano — il massimo
    // non può che scendere — e senza si perdevano tribune: su baku da 7 a 3.
    function filaAllineata(trackPts, seedIdx, side, barrierProfile, barrierDist, margine,
                           maxCols, accept, spanSamples, avanti) {
        let moduli = buildStandRow(trackPts, seedIdx, side,
            distanzaDalMuro(barrierProfile, barrierDist, margine), maxCols, accept, spanSamples, avanti);
        let muro = null;
        for (let giro = 0; giro < 4 && moduli.length; giro++) {
            const nuovo = muroDellaFila(trackPts, barrierProfile, barrierDist, moduli, side, spanSamples);
            if (muro !== null && Math.abs(nuovo - muro) < 1e-9) break;   // punto fisso
            muro = nuovo;
            moduli = buildStandRow(trackPts, seedIdx, side, muro + margine, maxCols, accept, spanSamples, avanti);
        }
        return { moduli, margine };
    }

    function buildGrandstandLayout(trackPts, pitPts, barrierDist, pitRoadHalf, accepted, rng, embankStart, embankOuter, fitsUnderBridge, mainStand, barrierProfile) {
        const layout = [];
        const groundPts = trackPts.filter(p => !p.bridge);
        const lapLen = TrackGeometry.lapLength(trackPts);
        // Quante SCHIERE tentare lungo il giro: la formula, senza tetto, sta
        // in `schiereDaTentare` accanto alle altre costanti delle tribune.
        const count = schiereDaTentare(lapLen);
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
            // Il seme deve già guardare la pista che ha davanti: se cade dove
            // due branche si avvicinano, tutta la fila nasce storta e la
            // ricerca dello slot è il posto giusto per scansarlo — scorrendo
            // di qualche campione invece di perdere la schiera.
            if (!TrackGeometry.guardaVersoLaPista(trackPts, {
                x, z, rotY: TrackGeometry.ribbonFacingAt(trackPts, idx, side,
                    () => barrierDist + GRANDSTAND_OFFSET_MARGIN, 1) })) return false;
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
            const { moduli: modules } = filaAllineata(
                trackPts, idx, side, barrierProfile, barrierDist, GRANDSTAND_OFFSET_MARGIN,
                ROW_MAX_COLS,
                (m) => {
                    if (trackPts[m.idx].bridge) return false;
                    if (TrackGeometry.nearestPoint(pitPts, m.x, m.z).dist < pitRoadHalf + GRANDSTAND_PIT_MARGIN) return false;
                    for (const s of (mainStand || [])) {
                        if (Math.hypot(m.x - s.x, m.z - s.z) < MAIN_STAND_ISOLATION) return false;
                    }
                    // Contro le strutture già accettate si guarda l'ingombro
                    // reale, non un raggio: una schiera lunga sfiorerebbe
                    // sempre qualcosa con un raggio unico e resterebbe corta.
                    const y = TrackGeometry.terrainHeightAt(groundPts, m.x, m.z, embankStart, embankOuter);
                    const cand = { asset, x: m.x, y, z: m.z, rotY: m.rotY, scale: CUSTOM_MODEL_SCALE };
                    for (const p of accepted) {
                        if (SceneryAssetSizes.itemsOverlap(cand, p)) return false;
                    }
                    return fitsUnderBridge(asset, m.x, m.z, y);
                },
                campioniDiMezzaLarghezza(trackPts, asset, CUSTOM_MODEL_SCALE));

            // Mai una tribuna isolata: o è una schiera leggibile, o niente.
            // Una singola in mezzo al nulla, o peggio a mezza distanza da una
            // schiera lunga, si legge come un buco (segnalato dall'utente).
            if (modules.length < ROW_MIN_COLS) continue;

            // `suMisuraSulMuro`: questi moduli sono già alla distanza giusta
            // dalla barriera, traslarli di nuovo li porterebbe nel prato.
            for (const m of modules) {
                const y = TrackGeometry.terrainHeightAt(groundPts, m.x, m.z, embankStart, embankOuter);
                // `margineDalMuro` viaggia con la tribuna perché la rete che
                // la protegge deve sapere di quanto avvicinarsi: il muro della
                // FILA non è quello del campione sotto il singolo modulo, e
                // ricalcolarlo lì la staccherebbe dalla tribuna.
                const stand = { asset, category: 'grandstand', suMisuraSulMuro: !!barrierProfile,
                                margineDalMuro: GRANDSTAND_OFFSET_MARGIN,
                                x: m.x, y, z: m.z, rotY: m.rotY, scale: CUSTOM_MODEL_SCALE };
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
    // `offset`: distanza dall'asse pista, numero oppure funzione (idx) =>
    // numero. Con la funzione la fila segue il MURO invece della barriera
    // storica, e questa è la differenza che conta: una fila generata sulla
    // barriera storica e poi spostata in blocco finisce dove la pista ha
    // un'altra direzione e resta girata come stava prima — allineata alle
    // compagne ma non alla barriera che ha davanti, segnalato in gioco il
    // 2026-08-12. Generandola già alla distanza giusta, ogni modulo prende la
    // rotazione del punto in cui sta davvero, e la catena continua a garantire
    // le distanze fra i moduli.
    // Mezza-larghezza di un asset espressa in campioni di pista: è la finestra
    // su cui prendere la direzione del muro, perché un modulo è un segmento
    // rigido e deve stare parallelo alla CORDA che sottende, non alla tangente
    // del suo centro. In unità di pista e non in campioni fissi: il passo vale
    // 5.17 unità su `prova` e 1.18 su `monte-rosso`.
    function campioniDiMezzaLarghezza(trackPts, asset, scale) {
        const stepLen = TrackGeometry.lapLength(trackPts) / trackPts.length;
        const misura = SceneryAssetSizes.sizeOf(asset);
        if (!misura || !stepLen) return 1;
        return Math.max(1, Math.round(misura.w * (scale || 1) / 2 / stepLen));
    }

    function buildStandRow(trackPts, startIdx, side, offset, maxCols, accept, spanSamples, avanti) {
        const distanzaA = typeof offset === 'function' ? offset : () => offset;

        function moduleAt(idx) {
            const p = trackPts[idx];
            const { nx, nz } = TrackGeometry.normalAt(trackPts, idx, true);
            // ⚠️ `side` va passato: `distanzaDalMuro` restituisce una funzione
            // di DUE argomenti e `barrierAt` fa `side > 0 ? right : left`.
            // Chiamandola col solo indice, side arrivava undefined e ogni
            // tribuna prendeva il muro sinistro — su new-monza una finiva a
            // 14.3 unità dal posto giusto (misurato il 2026-08-13).
            const d = distanzaA(idx, side);
            const x = p.x + nx * d * side;
            const z = p.z + nz * d * side;
            // L'oggetto guarda perpendicolarmente al NASTRO del muro, non
            // alla pista: dove il muro è in rampa le due direzioni divergono
            // e la tribuna risultava storta fino a 31°, che è la segnalazione
            // dell'utente al campione 620 di `prova`.
            return { x, z, idx,
                     rotY: TrackGeometry.ribbonFacingAt(trackPts, idx, side, distanzaA, spanSamples) };
        }

        // rotY si interpola come i due punti, e va normalizzato per non
        // attraversare il salto a ±π.
        //
        // ⚠️ Provato il 2026-08-13 a ricalcolarlo sul campione più vicino
        // invece di interpolarlo, pensando che l'interpolazione fosse la
        // causa delle tribune ancora storte in posizione intermedia: PEGGIORA
        // (prova, campione 412: da 12.9° a 23.5°). L'interpolazione fra i due
        // estremi è più vicina alla corda del modulo di quanto lo sia la
        // direzione di uno solo dei due.
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
        if (!accept(center) || !TrackGeometry.guardaVersoLaPista(trackPts, center)) return [];
        const modules = [center];
        // `avanti`, se dato, è quanti moduli si allungano NEL VERSO DI MARCIA:
        // il resto va all'indietro. Serve alla tribuna principale, che è
        // centrata sul traguardo ma deve guardare la GRIGLIA, che sta dietro
        // di esso — e soprattutto non deve arrivare addosso al ponte semafori,
        // che sta 75 unità avanti. Con la ripartizione simmetrica (3 avanti su
        // 7) il modulo di testa ci finiva sotto e restava senza rete
        // protettiva, segnalato in gioco il 2026-08-13.
        const forward = avanti === undefined ? maxCols - 1 - Math.floor((maxCols - 1) / 2)
                                             : Math.min(avanti, maxCols - 1);
        const back = maxCols - 1 - forward;
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
                if (!TrackGeometry.guardaVersoLaPista(trackPts, next)) break;
                // Rete di sicurezza contro i moduli accavallati: la catena
                // avanza per distanza reale, quindi qui la distanza è già
                // giusta, ma se un giorno smettesse di esserlo la schiera si
                // interrompe invece di consegnare moduli sovrapposti. Contro
                // TUTTI quelli già posati, perché in curva la catena può
                // ripiegarsi su se stessa e non solo sull'ultimo.
                if (modules.some(m => Math.hypot(m.x - next.x, m.z - next.z)
                                      < MAIN_STAND_COL_SPACING * ROW_MIN_SPACING_RATIO)) break;
                prev = next;
                modules.push(prev);
            }
        }
        return modules;
    }

    function buildMainGrandstandLayout(trackPts, pitPts, barrierDist, pitRoadHalf, side, embankStart, embankOuter, fitsUnderBridge, barrierProfile, accepted) {
        const layout = [];
        const groundPts = trackPts.filter(p => !p.bridge);
        const stackHeight = MAIN_STAND_TIER_HEIGHT * MAIN_STAND_TIERS;
        const gia = accepted || [];

        // Il seme è il traguardo, ma se il traguardo sta su un viadotto la
        // fila non può nascere lì: si poserebbe alla quota del terreno
        // SOTTOSTANTE e attraverserebbe la pista sopraelevata. Su `baku` 909
        // campioni su 1000 sono sopraelevati, traguardo compreso: senza questa
        // ricerca la tribuna principale sparisce del tutto, mentre prima
        // esisteva ma stava per metà dentro il viadotto. Si cerca il campione
        // a terra più vicino, in tutte e due le direzioni.
        let seme = 0;
        for (let d = 1; d < trackPts.length / 2 && trackPts[seme].bridge; d++) {
            const avanti = d % trackPts.length;
            const dietro = (trackPts.length - d) % trackPts.length;
            if (!trackPts[avanti].bridge) seme = avanti;
            else if (!trackPts[dietro].bridge) seme = dietro;
        }

        const { moduli: modules } = filaAllineata(
            trackPts, seme, side, barrierProfile, barrierDist, MAIN_STAND_OFFSET_MARGIN,
            MAIN_STAND_COLS,
            (m) => {
                // Gli stessi controlli delle schiere secondarie. Finché la fila
                // era di 7 moduli restava sul rettilineo di partenza e non
                // incontrava nulla; lunga il doppio arriva dove il tracciato
                // fa altro, e senza questi si posava su un viadotto (baku:
                // 6 moduli su 12, che poi restavano senza rete perché la rete
                // il controllo ce l'ha) o addosso al paddock.
                if (trackPts[m.idx].bridge) return false;
                if (TrackGeometry.nearestPoint(pitPts, m.x, m.z).dist < pitRoadHalf + GRANDSTAND_PIT_MARGIN) return false;
                // Se lì sopra passa un cavalcavia, la tribuna lo attraversa.
                const y = TrackGeometry.terrainHeightAt(groundPts, m.x, m.z, embankStart, embankOuter);
                if (!fitsUnderBridge('__stack__', m.x, m.z, y, stackHeight)) return false;
                const cand = { asset: MAIN_STAND_ASSET, x: m.x, y, z: m.z, rotY: m.rotY,
                               scale: CUSTOM_MODEL_SCALE };
                return !gia.some(p => SceneryAssetSizes.itemsOverlap(cand, p));
            },
            campioniDiMezzaLarghezza(trackPts, MAIN_STAND_ASSET, 1),
            MAIN_STAND_COLS_AVANTI);

        for (const m of modules) {
            const baseY = TrackGeometry.terrainHeightAt(groundPts, m.x, m.z, embankStart, embankOuter);
            for (let tier = 0; tier < MAIN_STAND_TIERS; tier++) {
                layout.push({
                    asset: MAIN_STAND_ASSET, category: 'grandstand-main',
                    suMisuraSulMuro: !!barrierProfile,
                    margineDalMuro: MAIN_STAND_OFFSET_MARGIN,
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
    function buildNatureLayout(rng, trackPts, pitPts, barrierDist, pitRoadHalf, accepted, embankStart, embankOuter, playerBoxFootprints, fitsUnderBridge) {
        const layout = [];
        const groundPts = trackPts.filter(p => !p.bridge);
        const { xMin, xMax, zMin, zMax } = trackBounds(trackPts, barrierDist);
        const tentativi = Math.round(NATURE_ATTEMPTS * fattoreGiro(TrackGeometry.lapLength(trackPts)));

        for (let i = 0; i < tentativi; i++) {
            const x = xMin + rng() * (xMax - xMin);
            const z = zMin + rng() * (zMax - zMin);

            const dTrack = TrackGeometry.nearestPoint(trackPts, x, z);
            if (dTrack.dist < barrierDist + NATURE_MIN_MARGIN) continue;
            if (dTrack.dist > barrierDist + NATURE_MAX_MARGIN) continue;
            if (TrackGeometry.nearestPoint(pitPts, x, z).dist < pitRoadHalf + PIT_NATURE_MARGIN) continue;
            if (isTooCloseToAny(accepted, x, z, NATURE_MIN_SPACING)) continue;

            const asset = weightedPick(rng, NATURE_ASSETS);
            if (ingombroInvadeBox(asset, x, z, playerBoxFootprints)) continue;
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
            const y = TrackGeometry.terrainHeightAt(groundPts, x, z, embankStart, embankOuter)
                    + SceneryHills.hillHeightAt(x, z, dGround, embankOuter,
                                               TrackGeometry.isInsideLoop(groundPts, x, z));
            if (!fitsUnderBridge(asset, x, z, y)) continue;
            const point = { asset, category: 'nature', x, y, z, rotY: rng() * Math.PI * 2, scale: NATURE_SCALE[asset] };
            layout.push(point);
            accepted.push(point);
        }
        return layout;
    }

    // Massi e affioramenti. Stessa struttura dello scatter della natura, con
    // due differenze che contano: partono molto più lontano dalla pista —
    // quella fascia diventerà via di fuga in ghiaia — e arrivano fin sui primi
    // pendii collinari, dove un albero starebbe scomodo e una roccia no.
    function buildRockLayout(rng, trackPts, pitPts, barrierDist, pitRoadHalf, accepted,
                             embankStart, embankOuter, playerBoxFootprints, fitsUnderBridge) {
        const layout = [];
        const groundPts = trackPts.filter(p => !p.bridge);
        const { xMin, xMax, zMin, zMax } = trackBounds(trackPts, barrierDist + ROCK_MAX_MARGIN);

        const tentativi = Math.round(ROCK_ATTEMPTS * fattoreGiro(TrackGeometry.lapLength(trackPts)));

        for (let i = 0; i < tentativi; i++) {
            const x = xMin + rng() * (xMax - xMin);
            const z = zMin + rng() * (zMax - zMin);

            const dTrack = TrackGeometry.nearestPoint(trackPts, x, z);
            if (dTrack.dist < barrierDist + ROCK_MIN_MARGIN) continue;
            if (dTrack.dist > barrierDist + ROCK_MAX_MARGIN) continue;
            if (TrackGeometry.nearestPoint(pitPts, x, z).dist < pitRoadHalf + ROCK_MIN_MARGIN) continue;
            if (isTooCloseToAny(accepted, x, z, ROCK_MIN_SPACING)) continue;

            const asset = weightedPick(rng, ROCK_ASSETS);
            if (ingombroInvadeBox(asset, x, z, playerBoxFootprints)) continue;
            const dGround = TrackGeometry.nearestPoint(groundPts, x, z).dist;
            const y = TrackGeometry.terrainHeightAt(groundPts, x, z, embankStart, embankOuter)
                    + SceneryHills.hillHeightAt(x, z, dGround, embankOuter,
                                               TrackGeometry.isInsideLoop(groundPts, x, z));
            if (!fitsUnderBridge(asset, x, z, y)) continue;

            const point = { asset, category: 'rock', x, y, z,
                            rotY: rng() * Math.PI * 2, scale: NATURE_SCALE[asset] };
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

    function buildWoodsLayout(rng, trackPts, barrierDist, embankOuter, accepted, fitsUnderBridge) {
        const layout = [];
        const groundPts = trackPts.filter(p => !p.bridge);
        const outer = embankOuter + SceneryHills.HILL_START_MARGIN + SceneryHills.HILL_RAMP;
        const { xMin, xMax, zMin, zMax } = trackBounds(trackPts, outer);

        const f = fattoreGiro(TrackGeometry.lapLength(trackPts));
        const macchie = Math.round(WOOD_CLUSTERS * f);
        const maxAlberi = Math.round(WOOD_MAX_TREES * f);

        for (let c = 0; c < macchie && layout.length < maxAlberi; c++) {
            const cxp = xMin + rng() * (xMax - xMin);
            const czp = zMin + rng() * (zMax - zMin);
            // Il centro della macchia deve cadere fuori dalla fascia di uscita
            // di pista: le macchie estratte troppo vicine si scartano invece
            // di spostarle, così la distribuzione resta uniforme.
            if (TrackGeometry.nearestPoint(groundPts, cxp, czp).dist < embankOuter + WOOD_MIN_MARGIN) continue;

            for (let k = 0; k < WOOD_PER_CLUSTER && layout.length < maxAlberi; k++) {
                const a = rng() * Math.PI * 2;
                const r = Math.sqrt(rng()) * WOOD_CLUSTER_RADIUS;   // sqrt: distribuzione uniforme sul disco
                const x = cxp + Math.cos(a) * r, z = czp + Math.sin(a) * r;
                const d = TrackGeometry.nearestPoint(groundPts, x, z).dist;
                if (d < embankOuter + WOOD_MIN_MARGIN) continue;
                if (isTooCloseToAny(accepted, x, z, WOOD_MIN_SPACING)) continue;

                // Tabella dedicata: nei boschi conta l'altezza, quindi domina
                // il pino e i cespugli non compaiono affatto.
                const asset = weightedPick(rng, WOOD_ASSETS);
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
    function findPondSpot(rng, trackPts, pitPts, barrierDist, pitRoadHalf, accepted, embankStart, embankOuter, playerBoxFootprints) {
        const groundPts = trackPts.filter(p => !p.bridge);
        const { xMin, xMax, zMin, zMax } = trackBounds(trackPts, barrierDist);

        const tentativi = Math.round(POND_ATTEMPTS * fattoreGiro(TrackGeometry.lapLength(trackPts)));

        for (let i = 0; i < tentativi; i++) {
            const x = xMin + rng() * (xMax - xMin);
            const z = zMin + rng() * (zMax - zMin);

            const dTrack = TrackGeometry.nearestPoint(trackPts, x, z);
            if (dTrack.dist < barrierDist + NATURE_MIN_MARGIN + POND_RADIUS) continue;
            if (dTrack.dist > barrierDist + NATURE_MAX_MARGIN) continue;
            if (TrackGeometry.nearestPoint(pitPts, x, z).dist < pitRoadHalf + PIT_NATURE_MARGIN + POND_RADIUS) continue;
            // Il laghetto non ha un asset: il suo ingombro è il raggio.
            if (insidePlayerBoxFootprint(x, z, playerBoxFootprints)
                || playerBoxFootprints.some(poly => distanzaDalPoligono(x, z, poly) < POND_RADIUS)) continue;
            if (isTooCloseToAny(accepted, x, z, POND_CLEARANCE)) continue;

            const y = TrackGeometry.terrainHeightAt(groundPts, x, z, embankStart, embankOuter);
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
    // La scenografia viene calcolata con la barriera "di base" (quella di
    // sempre) e poi spostata in blocco verso l'esterno di quanto la barriera
    // si è davvero allontanata in quel punto: è il requisito dell'utente —
    // tutto esattamente come ora, semplicemente traslato dopo la barriera.
    //
    // Segue la BARRIERA e non la ghiaia: dal momento in cui il muro arretra
    // anche dove ghiaia non ce n'è (via di fuga in erba, Task 7a), traslare
    // sulla ghiaia lascerebbe tribune e cartelloni dentro la via di fuga sui
    // rettilinei, o murati.
    //
    // Perché a valle e non riscrivendo le ~50 occorrenze di barrierDist nei
    // sei moduli di scenografia: dove la ghiaia è 0 lo spostamento è 0, quindi
    // i rettilinei restano identici PER COSTRUZIONE e i test esistenti
    // continuano a valere. Le distanze reciproche si conservano — gli oggetti
    // della stessa zona traslano insieme, e spostarsi verso l'esterno di una
    // curva li allontana fra loro (raggio maggiore), mai li avvicina: nessuna
    // compenetrazione nuova possibile.
    //
    // Le colline e il prato NON passano di qui: sono terreno, non oggetti, e
    // stanno centinaia di unità più in là.
    // ⚠️ Le schiere di tribuna traslano RIGIDE, non modulo per modulo.
    // Ogni modulo vede un campione diverso e quindi uno spostamento diverso:
    // lasciandoli liberi la schiera si accartoccia e i moduli si compenetrano
    // — misurate 8 coppie su prova (la peggiore a 10.7 invece di 19.2, girate
    // di 25°) e una a 4.9 su new-monza, cioè le "tribune storte" viste in
    // gioco. Senza traslazione le stesse schiere non hanno una sola
    // compenetrazione, il che dice che il difetto nasce qui e non nel modo in
    // cui vengono composte.
    //
    // Il gruppo si sposta del MASSIMO fra gli spostamenti dei suoi moduli e
    // lungo la direzione di quello che lo richiede: così nessun modulo resta
    // dentro la via di fuga, e la schiera resta la fila dritta che era.
    function spostamentoDi(voce, trackPts, barrierProfile, barrierDist) {
        const near = TrackGeometry.nearestPoint(trackPts, voce.x, voce.z);
        if (near.dist < barrierDist) return null;
        const p = trackPts[near.index];
        const { nx, nz } = TrackGeometry.normalAt(trackPts, near.index, true);
        const lato = Math.sign((voce.x - p.x) * nx + (voce.z - p.z) * nz) || 1;
        const quanto = TrackGravel.sceneryShiftAt(barrierProfile, near.index, lato, barrierDist);
        if (quanto <= 0) return null;
        return { dx: nx * quanto * lato, dz: nz * quanto * lato, quanto };
    }

    function traslaOltreLaGhiaia(layout, trackPts, barrierProfile, groundPts, barrierDist, embankStart, embankOuter) {
        if (!barrierProfile) return layout;

        for (const voce of layout) {
            // Le tribune e le reti che le proteggono NON passano di qui: sono
            // già nate alla distanza del muro (`distanzaDalMuro`), e spostarle
            // una seconda volta le porterebbe nel prato. È anche il motivo per
            // cui la fila resta parallela alla barriera: ogni modulo prende la
            // rotazione del punto in cui sta davvero, invece di conservare
            // quella del punto da cui è partito.
            if (voce.suMisuraSulMuro) continue;
            // Gli edifici del fronte box sono nati misurando la CORSIA, non la
            // pista. Questa passata allontana dalla pista e della corsia non sa
            // niente: su melbourne ce li spingeva dentro, fino a 4.29 unità.
            if (voce.natoSullaCorsia) continue;
            const near = TrackGeometry.nearestPoint(trackPts, voce.x, voce.z);
            const p = trackPts[near.index];
            const { nx, nz } = TrackGeometry.normalAt(trackPts, near.index, true);
            // Le strutture che SCAVALCANO la pista — ponte semafori e
            // passerella — hanno il pivot sull'asse, quindi stanno dentro la
            // linea della barriera per costruzione. Vanno lasciate stare: la
            // passata correttiva più sotto, presa alla lettera, le
            // scaraventerebbe a bordo circuito.
            if (near.dist < barrierDist) continue;
            // Da che lato della pista sta la voce: segno della componente
            // normale del vettore centro-pista -> oggetto.
            const lato = Math.sign((voce.x - p.x) * nx + (voce.z - p.z) * nz) || 1;
            const spostamento = TrackGravel.sceneryShiftAt(barrierProfile, near.index, lato, barrierDist);
            if (spostamento <= 0) continue;

            voce.x += nx * spostamento * lato;
            voce.z += nz * spostamento * lato;

            // Correzione: lo spostamento è calcolato sul campione più vicino
            // PRIMA di muoversi, ma muovendosi l'oggetto può ritrovarsi più
            // vicino a un altro campione, dove il muro è più in là — succede
            // ai bordi della zona protetta del traguardo, dove la barriera
            // sale da 15 a 33 nel giro di poche unità. Misurato: senza questa
            // passata un cartellone su prova restava dentro la via di fuga di
            // 10 unità (1 voce su 668, ma proprio davanti alle tribune).
            //
            // Poche iterazioni bastano: ogni passo allontana, e il profilo del
            // muro ha pendenza limitata, quindi il residuo si esaurisce.
            for (let giro = 0; giro < 3; giro++) {
                const ora = TrackGeometry.nearestPoint(trackPts, voce.x, voce.z);
                const q = trackPts[ora.index];
                const n2 = TrackGeometry.normalAt(trackPts, ora.index, true);
                const lato2 = Math.sign((voce.x - q.x) * n2.nx + (voce.z - q.z) * n2.nz) || 1;
                const residuo = TrackGravel.barrierAt(barrierProfile, ora.index, lato2) - ora.dist;
                if (residuo <= 0) break;
                voce.x += n2.nx * residuo * lato2;
                voce.z += n2.nz * residuo * lato2;
            }
            // Quota ricalcolata alla posizione nuova. In pratica non cambia
            // (la ghiaia esiste solo dove il terreno è in piano), ma è una
            // garanzia, non un'ipotesi.
            if (typeof voce.y === 'number') {
                voce.y = TrackGeometry.terrainHeightAt(groundPts, voce.x, voce.z, embankStart, embankOuter);
            }
        }
        return layout;
    }

    // Distanza massima raggiunta dalla barriera sul giro, con un margine per
    // il suo stesso spessore. Senza profilo (chiamanti storici, editor,
    // test) resta la barriera fissa di sempre: comportamento invariato.
    const BARRIER_THICKNESS_MARGIN = 3;
    function embankmentStart(barrierProfile, barrierDist) {
        if (!barrierProfile) return barrierDist;
        let max = barrierDist;
        for (const lato of ['left', 'right']) {
            const b = barrierProfile[lato];
            for (let i = 0; i < b.length; i++) if (b[i] > max) max = b[i];
        }
        return max + BARRIER_THICKNESS_MARGIN;
    }

    // barrierProfile (opzionale): profilo della barriera, da
    // TrackGravel.barrierProfile. Omesso, il layout è identico a quello di
    // prima che le vie di fuga esistessero.
    function generateLayout(trackData, trackPts, pitPts, barrierDist, embankmentWidth = 45, seatAnchors = null, barrierProfile = null, terraceAnchors = null, opzioni = null) {
        // Quanti box dei piloti occupano la corsia. Arriva dalla lobby (vedi
        // f1.js: clientSettings.gridSize) e arriva PRIMA che la scenografia si
        // generi — il commento storico su PLAYER_BOX_MAX_COUNT diceva il
        // contrario ("si genera prima di sapere quanti giocatori
        // parteciperanno") e da lì nasceva il difetto: si riservava sempre lo
        // spazio del caso peggiore, e con pochi piloti restava corsia vuota.
        const gridSize = Math.max(1, (opzioni && opzioni.gridSize) || PLAYER_BOX_MAX_COUNT);
        const rng = mulberry32(hashString(trackData.id));
        const pitRoadHalf = trackData.pit.roadHalfWidth;
        const side = mainStandSide(trackPts, pitPts);
        // Fin dove il terreno resta alla QUOTA DELLA PISTA prima di degradare
        // al prato in piano. Non è più `barrierDist`: da quando la barriera
        // arretra per la via di fuga, il pianoro deve arrivare almeno fino a
        // lei, altrimenti nelle zone sopraelevate il muro resta sospeso sul
        // pendio e tribune e alberi si piantano più in basso della pista —
        // difetto visto in playtest il 2026-08-11.
        //
        // Si prende la distanza MASSIMA raggiunta dalla barriera sul giro, non
        // quella locale: la quota del terreno è consultata da punti qualunque
        // del mondo (mesh del prato, oggetti sparsi, quota visiva dell'auto
        // fuoripista) e un pianoro che cambia larghezza punto per punto
        // richiederebbe a tutti di sapere a quale campione appartengono. Il
        // costo è un ripiano un po' più largo del necessario dove la barriera
        // è vicina, che non si vede: dove la pista è in piano (y=0) il
        // terrapieno non esiste comunque.
        const embankStart = embankmentStart(barrierProfile, barrierDist);
        const embankOuter = embankStart + embankmentWidth;
        // Ingombro reale di ciascun box giocatore (caso peggiore,
        // PLAYER_BOX_MAX_COUNT box pieni — vedi commento sopra): calcolato
        // una volta qui, riusato per escludere paddock/natura/laghetto da
        // tutta la fila reale, non solo dal punto centrale pitBoxIndex.
        const boxAnchors = TrackGeometry.pitBoxAnchors(trackData.pit.path, trackData.pit.boxIndex, gridSize);
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


        const paddock   = buildPaddockLayout(trackPts, pitPts, barrierDist, pitRoadHalf, side, embankStart, embankOuter, playerBoxFootprints, fitsUnderBridge,
            { pitPath: trackData.pit.path, boxIndex: trackData.pit.boxIndex, gridSize });
        const mainStand = buildMainGrandstandLayout(trackPts, pitPts, barrierDist, pitRoadHalf, side, embankStart, embankOuter, fitsUnderBridge, barrierProfile, paddock);
        const accepted  = [...paddock, ...mainStand];
        const grandstand = buildGrandstandLayout(trackPts, pitPts, barrierDist, pitRoadHalf, accepted, rng, embankStart, embankOuter, fitsUnderBridge, mainStand, barrierProfile);
        // Le tribune entrano nel registro. Senza questa riga TUTTO cio' che
        // viene posato dopo — ponte semafori, gomme, decoro del paddock,
        // natura, paddock-life, boschi — era cieco rispetto a loro, ed e' da
        // li' che nascevano il banner dentro la tribuna (5.6 unita'), il pylon
        // dentro la tribuna (3.0) e il motorhome dentro la tribuna (3.1).
        //
        // E' la PREVENZIONE, distinta dalla garanzia: la porta in fondo a
        // questa funzione impedirebbe comunque a quegli oggetti di entrare, ma
        // li scarterebbe. Vedendoli, chi piazza sceglie un altro posto invece
        // di perdere il pezzo — su melbourne il decoro del paddock passava da
        // 6 pezzi a 5.
        accepted.push(...grandstand);

        // Landmark (torre, ponte semafori, podio, passerella): calcolati
        // prima della natura, così lo scatter degli alberi li vede fra gli
        // oggetti già accettati e non ci finisce sopra.
        const landmarks = SceneryLandmarks.buildLandmarks(
            trackPts, pitPts, barrierDist, side, embankStart, embankOuter,
            playerBoxFootprints, insidePlayerBoxFootprint, fitsUnderBridge, pitRoadHalf,
            accepted, barrierProfile);
        accepted.push(...landmarks);

        // Elementi distribuiti in base alla curvatura (gomme, cartelli di
        // frenata, commissari, reti, barriere di cemento, decoro paddock).
        const trackside = SceneryTrackside.buildTrackside({
            trackPts, pitPts, barrierDist, pitRoadHalf, embankStart, embankOuter, mainSide: side, rng,
            playerBoxFootprints, insidePlayerBoxFootprint, fitsUnderBridge, barrierProfile,
            // Gli asset che scavalcano la pista: quello che si posa qui sotto
            // deve stargli fuori, e finora non li guardava nessuno.
            spanning: landmarks.filter(v => v.asset === 'footbridge' || v.asset === 'startGantry'),
            grandstands: [...mainStand, ...grandstand],
            // Tutto ciò che è già a terra: serve al decoro del paddock, che
            // finiva dentro gli edifici box (vedi buildTrackside).
            accepted,
        });

        // Il verde deve vedere il DECORO del paddock, che il trackside ha
        // appena posato: tende e birilli stanno larghi, lontano dalla
        // barriera, e un albero ci cresceva dentro (1 caso su prova, 1 su
        // baku — proprio ciò che l'utente ha segnalato).
        //
        // ⚠️ Solo il decoro, non tutto il trackside. Gomme, cartelli e
        // commissari stanno a ridosso della barriera, dove alberi non ce ne
        // sono: misurati ZERO alberi dentro di loro. Aggiungerli toglieva 9
        // alberi su prova senza correggere niente, e le direzioni spoglie
        // sull'orizzonte passavano dal 16% al 20% — il tetto del test.
        accepted.push(...trackside.filter(v => v.category === 'paddock-decor'));

        // Tribuna e rete sono UNA decisione, non due. La rete nasce dalla
        // tribuna (stesso centro, stessa rotazione, scala derivata), ma tre
        // condizioni potevano farla sparire — tratto di ponte, spazio non
        // utilizzabile, un'altra tribuna di mezzo — lasciando la tribuna lì,
        // scoperta a bordo pista. Misurato il 2026-08-24: 15 tribune su 110
        // senza rete su melbourne, 4 su shanghai, 2 su new-monza.
        //
        // Il difetto non era che la rete mancasse: era che potessero esistere
        // separatamente. Quindi cade la tribuna: una in meno non la nota
        // nessuno, una senza protezione sì.
        //
        // ⚠️ Il filtro sta QUI e non prima di buildTrackside: le reti nascono
        // da lì, e senza le tribune non nascerebbero affatto.
        const conRete = new Set(trackside.filter(v => v.asset === 'catchFence').map(v => v.daTribuna));
        const scoperta = (s) => !conRete.has(s.x.toFixed(2) + ',' + s.z.toFixed(2));

        // DOVE PASSA UN PONTE, TRIBUNE NON CE NE SONO.
        //
        // Regola dettata dall'utente il 2026-08-24: il ponte dei semafori deve
        // avere «i due pilastri oltre le barriere da entrambi i lati» e deve
        // stare vicino alla griglia, se no al via non si legge il semaforo.
        // Le due cose insieme mettono i suoi pilastri esattamente dove
        // starebbero le tribune — quindi cede la tribuna, non il ponte. Vale
        // uguale per la passerella, l'arco senza semafori.
        //
        // ⚠️ Si toglie il MODULO che sta sotto la campata, non si accorcia la
        // fila: accorciarla era gia' stato provato il 2026-08-13 e aveva
        // lasciato un buco di 72 unita' fra la fine della fila e la schiera
        // successiva (segnalazione M 20). Un modulo in meno lascia lo spazio
        // dei pilastri, che e' quello che nella realta' c'e' davvero.
        const scavalcanti = landmarks.filter(
            v => v.asset === 'startGantry' || v.asset === 'footbridge');
        const sottoIlPonte = (s) => scavalcanti.some(g => SceneryAssetSizes.itemsOverlap(s, g));

        const utile = (s) => !scoperta(s) && !sottoIlPonte(s);
        const mainStandCoperte = mainStand.filter(utile);
        const grandstandCoperte = grandstand.filter(utile);

        // Infrastrutture: DOPO il trackside, così vedono tribune, reti, gomme
        // e landmark già posati; PRIMA della natura, così sono gli alberi a
        // scansarsi da loro e non viceversa.
        //
        // RNG proprio, come folla e boschi: pescare dalla sequenza condivisa
        // legherebbe la scenografia a quante infrastrutture ci stanno, ed è
        // esattamente il difetto che ha fatto diradare i boschi il 2026-08-13.
        const infrastrutture = SceneryInfrastructure.buildInfrastructure({
            trackPts, pitPts, barrierDist, pitRoadHalf, embankStart, embankOuter,
            barrierProfile, playerBoxFootprints, insidePlayerBoxFootprint, fitsUnderBridge,
            accepted: [...accepted, ...trackside],
            grandstands: [...mainStand, ...grandstand],
            spanning: landmarks.filter(v => v.asset === 'footbridge' || v.asset === 'startGantry'),
            rng: mulberry32(hashString(trackData.id + ':infra')),
            palette: PALETTE_INFRASTRUTTURE,
        });
        accepted.push(...infrastrutture);

        const nature = buildNatureLayout(rng, trackPts, pitPts, barrierDist, pitRoadHalf, accepted, embankStart, embankOuter, playerBoxFootprints, fitsUnderBridge);
        const paddockLife = SceneryPaddock.buildLayout(rng, trackPts, pitPts, barrierDist, accepted,
            (voce) => itemHitsPlayerBoxZone(voce, playerBoxFootprints));

        // Boschi DOPO la natura: le macchie vedono fra gli oggetti già
        // accettati anche gli alberi vicini alla pista, e non ci finiscono
        // sopra.
        // RNG separato, come per la folla e per lo stesso motivo al contrario:
        // la fittezza dei boschi è una LOTTERIA della sequenza condivisa. Il
        // 2026-08-13, raddoppiando le tribune, sono bastate le poche estrazioni
        // in più consumate a monte (una per schiera, per scegliere la variante)
        // a far scivolare la densità media da 3.0 a 2.9 vicini per albero —
        // sotto la soglia del test, senza che nessun albero avesse cambiato
        // posto per un motivo geometrico. Con un seme suo, i boschi non
        // dipendono più da quante tribune ci sono.
        const woods  = buildWoodsLayout(mulberry32(hashString(trackData.id + ':woods')),
                                        trackPts, barrierDist, embankOuter, accepted, fitsUnderBridge);
        // Le rocce dopo gli alberi: si scansano da loro e non viceversa,
        // perché sono molte meno e possono permettersi di cercare posto.
        const rocce  = buildRockLayout(rng, trackPts, pitPts, barrierDist, pitRoadHalf,
                                       accepted, embankStart, embankOuter, playerBoxFootprints, fitsUnderBridge);
        const pond   = findPondSpot(rng, trackPts, pitPts, barrierDist, pitRoadHalf, accepted, embankStart, embankOuter, playerBoxFootprints);

        const layout = [...paddock, ...mainStandCoperte, ...grandstandCoperte, ...landmarks,
                        ...trackside, ...infrastrutture,
                        ...nature, ...woods, ...rocce, ...paddockLife];
        if (pond) layout.push(pond);
        traslaOltreLaGhiaia(layout, trackPts, barrierProfile,
            trackPts.filter(p => !p.bridge), barrierDist, embankStart, embankOuter);

        // DAVANTI A UNA TRIBUNA CI VA SOLO LA SUA RETE.
        //
        // Le tre segnalazioni M 21, 22 e 23 del 2026-08-13 sono lo stesso
        // quadro: muro di gomme, capanno commissari, rete, tribuna, tutti
        // impilati nello stesso metro quadro. L'utente: «ora lì ci sono i
        // grandstand e quindi li dobbiamo levare».
        //
        // Non è un difetto del loro piazzamento: gomme e commissari nascono a
        // `barrierDist + margine`, ben davanti alle tribune. È
        // `traslaOltreLaGhiaia` che porta al muro tutto ciò che non è già
        // dimensionato sul muro — e al muro, dove la via di fuga è larga, ci
        // sta anche la fila di tribune, che invece NON trasla (porta
        // `suMisuraSulMuro`). Il conflitto quindi esiste solo qui, dopo la
        // traslazione, ed è l'unico punto in cui si può vedere.
        //
        // La fascia è larga quanto la tribuna e profonda 22 unità verso la
        // pista, misurate dal suo centro: la rete sta a 12.5, il muro di gomme
        // a ~19. Sul lato opposto della pista non arriva mai — la tribuna sta
        // a muro+10 e il muro di fronte a -muro, cioè almeno 36 unità più in
        // là.
        const FASCIA_DAVANTI = 22;
        const SOLO_LA_RETE = new Set(['tyreStack', 'marshalPost']);
        const tribune = [...mainStandCoperte, ...grandstandCoperte];
        for (let i = layout.length - 1; i >= 0; i--) {
            const v = layout[i];
            // I cartelli di frenata restano: servono a chi guida, e sono
            // l'unica voce di questa famiglia che l'utente non ha segnalato.
            // Basta che non finiscano DENTRO una tribuna.
            if (v.asset === 'brakingBoard') {
                if (tribune.some(g => SceneryAssetSizes.itemsOverlap(v, g))) layout.splice(i, 1);
                continue;
            }
            if (!SOLO_LA_RETE.has(v.asset)) continue;
            const dentro = tribune.some(g => {
                // Assi locali della tribuna: `u` lungo la sua larghezza, `f`
                // nella direzione in cui guarda, cioè verso la pista.
                const c = Math.cos(g.rotY || 0), s = Math.sin(g.rotY || 0);
                const dx = v.x - g.x, dz = v.z - g.z;
                const du = dx * c - dz * s;
                const df = dx * s + dz * c;
                const meta = (SceneryAssetSizes.sizeOf(g.asset).w * (g.scale || 1)
                            + SceneryAssetSizes.sizeOf(v.asset).w * (v.scale || 1)) / 2;
                return Math.abs(du) <= meta && df > 0 && df <= FASCIA_DAVANTI;
            });
            if (dentro) layout.splice(i, 1);
        }

        // ...E DENTRO UN'INFRASTRUTTURA NON CI VA NIENTE.
        //
        // Stesso identico meccanismo del blocco qui sopra, e per questo sta
        // qui e non fra i vincoli del modulo: `buildInfrastructure` guarda
        // `trackside` e non ci finisce dentro, ma poi `traslaOltreLaGhiaia`
        // porta al muro gomme, capanni, cartelli e striscioni — che non sono
        // dimensionati sul muro — mentre le infrastrutture NON traslano
        // (`suMisuraSulMuro`). Il conflitto nasce dopo, ed è visibile solo
        // qui: misurate 7 compenetrazioni sui quattro tracciati il 2026-08-14
        // (gru dentro i muri di gomme, terrazze sopra un capanno commissari).
        //
        // A cedere è l'arredo minore, non il volume: è la stessa scelta fatta
        // per le tribune. Solo oggetti PUNTUALI e ripetuti — reti e barriere
        // continue restano dove sono, perché toglierne un pezzo aprirebbe un
        // varco nella protezione.
        const CEDONO_ALL_INFRASTRUTTURA = new Set([
            'tyreStack', 'marshalPost', 'brakingBoard', 'banner']);
        if (infrastrutture.length) {
            for (let i = layout.length - 1; i >= 0; i--) {
                const v = layout[i];
                if (!CEDONO_ALL_INFRASTRUTTURA.has(v.asset)) continue;
                // Ingombro reale orientato, mai la distanza fra i centri: una
                // gru è 10.3 × 12.4 e un capanno 5.5 × 4.5, e a 6 unità di
                // distanza fra i centri sono già uno dentro l'altro.
                if (infrastrutture.some(g => SceneryAssetSizes.itemsOverlap(v, g))) {
                    layout.splice(i, 1);
                }
            }
        }

        // Spettatori DOPO la traslazione, non prima.
        //
        // Ogni posto è espresso in coordinate locali alla tribuna, quindi la
        // folla va generata quando le tribune sono già dove staranno. Facendolo
        // prima, traslaOltreLaGhiaia spostava tribuna e spettatori ognuno per
        // conto proprio — sono in punti diversi, quindi vedono campioni e
        // spostamenti diversi — e la gente si staccava dai gradoni: misurati
        // 2394 spettatori su 2983 fuori posto su prova, fino a 11.85 unità.
        // `mainStand` e `grandstand` contengono gli stessi oggetti del layout,
        // che la traslazione ha già aggiornato sul posto.
        //
        // RNG separato apposta: pescare dalla sequenza principale in un punto
        // diverso avrebbe cambiato tutti gli scatter successivi (alberi,
        // rocce, boschi) su tracciati che l'utente ha già approvato.
        const crowd = SceneryCrowd.buildCrowd([...mainStandCoperte, ...grandstandCoperte], seatAnchors,
            mulberry32(hashString(trackData.id + ':crowd')));

        // Spettatori sulle terrazze: RNG proprio, come la folla delle tribune,
        // e per lo stesso motivo — legarli alla sequenza condivisa farebbe
        // cambiare la folla ogni volta che cambia il numero di infrastrutture.
        // Anche loro dopo la traslazione, per la stessa ragione della folla:
        // le ancore sono locali all'oggetto, quindi l'oggetto deve già essere
        // dove starà.
        const terrazze = infrastrutture.filter(
            v => v.asset === 'hospitalityDeck' || v.asset === 'vipSuite');
        const terraceCrowd = SceneryCrowd.buildTerraceCrowd(
            terrazze, terraceAnchors || {}, mulberry32(hashString(trackData.id + ':terrace')));

        // LA PORTA. Tutto ciò che è stato deciso qui sopra passa di qui, una
        // volta, nell'ordine in cui è stato deciso: chi arriva prima ha la
        // precedenza, chi non ci sta non entra.
        //
        // È il punto che rende vera la promessa fatta all'utente il
        // 2026-08-24 — «non voglio più questi bug in una qualsiasi possibile
        // pista che posso creare». Non perché i costruttori siano diventati
        // più bravi, ma perché non esiste più una strada nel layout che salti
        // il controllo: un modulo nuovo, un asset nuovo, una pista nuova o
        // passano da qui o non sono nella scenografia.
        //
        // Le voci senza modello (laghetto, asfalto del parcheggio, folla) non
        // hanno un ingombro da rispettare e passano dritte. Le reti nascono
        // attaccate alla loro tribuna: è il loro mestiere, e la tribuna entra
        // nel registro DOPO, non contro (vedi l'ordine qui sotto).
        const registro = SceneryRegistro.crea({
            trackPts, pitPts, roadHalf: trackData.roadHalfWidth,
            pitRoadHalf: trackData.pit.roadHalfWidth, playerBoxFootprints,
            // Dov'e' il muro, campione per campione. Non un numero: la via di
            // fuga si allarga dove serve, e un valore fisso direbbe la cosa
            // sbagliata proprio nei punti che contano.
            muroAl: barrierProfile
                ? (i, side) => TrackGravel.barrierAt(barrierProfile, i, side)
                : () => barrierDist,
        });
        // Non negoziabili: il ponte dei semafori porta il via (senza, la gara
        // non si legge) e i box dei piloti sono geometria di gioco. Entrano
        // nel registro senza essere giudicati.
        //
        // NON NEGOZIABILI. Alcune cose non si scartano mai, perche' toglierne
        // una e' peggio del difetto che si voleva togliere:
        //  - il ponte dei semafori porta il via: senza, la gara non si legge;
        //  - il fronte della corsia box e la fila del traguardo sono FILE
        //    CONTINUE, e un buco in mezzo si vede a colpo d'occhio. Le loro
        //    violazioni si curano alla fonte, dove nascono (vedi lo scostamento
        //    degli edifici box qui sopra), non scartandole qui.
        // Entrano nel registro senza essere giudicate: gli altri devono
        // VEDERLE, non poterle rimuovere.
        const NON_SCARTABILI = new Set(['paddock', 'grandstand-main']);
        const intoccabili = layout.filter(
            v => v.asset === 'startGantry' || NON_SCARTABILI.has(v.category));
        registro.aggiungiTutti(intoccabili);
        let passate = [];
        let scartate = 0;
        for (const voce of layout) {
            if (!voce.asset || SENZA_INGOMBRO.has(voce.category)) { passate.push(voce); continue; }
            if (voce.asset === 'startGantry' || NON_SCARTABILI.has(voce.category)) {
                passate.push(voce); continue;   // già registrate sopra
            }
            if (registro.posa(voce)) { passate.push(voce); continue; }
            scartate++;
        }
        // Un conteggio, non un elenco: in gioco questo gira ad ogni
        // caricamento e cento righe in console non le legge nessuno. Chi vuole
        // i dettagli ha scenografiaInvarianti.test.js.
        if (scartate && typeof console !== 'undefined' && console.debug) {
            console.debug(`[scenografia] ${scartate} oggetti scartati dalla porta su ${layout.length}`);
        }

        // GLI OGGETTI TOLTI A MANO DALL'AUTORE, se la pista ne elenca.
        //
        // Stanno QUI e non dopo il `return` per un motivo preciso: togliendoli
        // prima del taglio degli orfani, una tribuna esclusa si porta via la
        // sua rete e i suoi spettatori con il meccanismo che esiste gia' —
        // invece di lasciare in piedi una rete da sola e centootto persone
        // sedute nel vuoto.
        //
        // E stanno dentro generateLayout, non nei chiamanti, perche' i
        // chiamanti sono cinque (il gioco, l'editor, l'anteprima, la cottura,
        // il conto dei costi): una porta sola, come per il registro.
        // Rif. spec 2026-08-25-f1-densita-scenografia-design.md
        if (trackData.scenografiaEsclusi && trackData.scenografiaEsclusi.length) {
            const esito = SceneryEsclusioni.applica(passate, trackData.scenografiaEsclusi);
            passate = esito.layout;
            // ⚠️ Un'esclusione che non trova piu' il suo oggetto va DETTA:
            // vuol dire che l'oggetto si e' spostato ed e' ancora in pista.
            if (esito.nonTrovate.length && typeof console !== 'undefined' && console.warn) {
                console.warn(`[scenografia] ${esito.nonTrovate.length} oggetti da togliere non `
                    + `sono stati trovati (si sono spostati?): ${esito.nonTrovate.join(', ')}`);
            }
        }

        // Tribuna e rete restano una cosa sola anche QUI, in uscita: se la
        // porta ha scartato una tribuna, la sua rete non deve restare in piedi
        // da sola in mezzo al prato. Il legame vale nei due sensi — senza
        // tribuna niente rete, senza rete niente tribuna (vedi il filtro
        // `scoperta` piu' sopra).
        const tribuneRimaste = new Set(passate
            .filter(v => v.category === 'grandstand' || v.category === 'grandstand-main')
            .map(v => v.x.toFixed(2) + ',' + v.z.toFixed(2)));
        const senzaOrfane = passate.filter(
            v => v.asset !== 'catchFence' || tribuneRimaste.has(v.daTribuna));

        // E VALE ANCHE PER LA FOLLA. Gli spettatori nascono prima della porta
        // e la attraversano senza ingombro (sono seduti su una tribuna, non a
        // terra): se la porta scarta la tribuna dopo, restano seduti nel
        // vuoto. E' lo stesso difetto degli orfani chiuso per le reti, e
        // l'utente l'ha visto su shanghai davanti al traguardo. Misurato il
        // 2026-08-24 prima della cura: 173 spettatori a mezz'aria su
        // melbourne, 120 su shanghai, 28 su test.
        //
        // Le terrazze entrano nello stesso insieme delle tribune: per uno
        // spettatore «la mia tribuna» e' l'oggetto su cui poggia, quale che
        // sia la sua categoria.
        const sedutiRimasti = new Set([...tribuneRimaste]);
        for (const v of passate) {
            if (v.asset === 'hospitalityDeck' || v.asset === 'vipSuite') {
                sedutiRimasti.add(v.x.toFixed(2) + ',' + v.z.toFixed(2));
            }
        }
        const follaRimasta = crowd.concat(terraceCrowd)
            .filter(v => sedutiRimasti.has(v.daTribuna));

        return senzaOrfane.concat(follaRimasta);
    }

    return {
        generateLayout, embankmentStart, hashString, mulberry32, schiereDaTentare, fattoreGiro,
        PIT_BUILDING_OFFSET_MARGIN,
        playerBoxFootprintCorners, playerBoxApronCorners,
        insidePlayerBoxFootprint, PLAYER_BOX_MAX_COUNT,
        PLAYER_BOX_OFFSET_MARGIN, PLAYER_BOX_LOCAL_BOUNDS
    };
});
