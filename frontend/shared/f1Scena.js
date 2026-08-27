// frontend/shared/f1Scena.js
//
// LA SCENA DEL CIRCUITO, costruita una volta sola per chiunque la voglia.
//
// Prima queste righe stavano dentro f1.js, in mezzo alla partita: quindici
// chiamate a TrackMeshBuilder e quattordici parametri calcolati fra una e
// l'altra. Chiunque altro volesse la stessa scena — l'anteprima esplorabile,
// domani un generatore di immagini — doveva ricopiarle, e una copia diverge.
// In questo progetto è già successo tre volte: l'ingombro finto degli asset,
// il cono del traguardo specchiato, la formula delle gomme che stava per
// essere riscritta nell'editor.
// Rif. docs/superpowers/specs/2026-08-24-f1-anteprima-esplorabile-design.md
//
// ⚠️ IL CONFINE È `buildStartingGrid`: da lì in poi comincia lo stile
// cel-shaded, che è del gioco e non di questa funzione. Le mesh che vanno
// stilizzate a parte (prato e superfici) vengono RESTITUITE, non convertite.
//
// Usa THREE per i materiali, come trackMeshBuilder.js; niente DOM.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./trackGeometry.js'), require('./trackGravel.js'),
                                 require('./trackScenery.js'), require('./toonPalette.js'),
                                 require('./trackAcrobatico.js'), require('./sceneryHills.js'),
                                 require('./cittaProfilo.js'));
    } else {
        root.F1Scena = factory(root.TrackGeometry, root.TrackGravel, root.TrackScenery, root.ToonPalette,
                               root.TrackAcrobatico, root.SceneryHills, root.CittaProfilo);
    }
})(typeof self !== 'undefined' ? self : this, function (TrackGeometry, TrackGravel, TrackScenery, ToonPalette,
                                                        TrackAcrobatico, SceneryHills, CittaProfilo) {

    // Il global, per arrivare a TrackMeshBuilder senza richiederlo (vedi sotto).
    const glob = typeof self !== 'undefined' ? self
        : (typeof globalThis !== 'undefined' ? globalThis : {});

    const CURB_W = 2.8;
    // Ampiezza del terrapieno oltre il pianoro, entro cui la quota del terreno
    // sfuma dalla quota pista a 0 (prato in piano). Si tara solo qui, non in
    // TrackGeometry.terrainHeightAt né in TrackMeshBuilder.
    const EMBANKMENT_WIDTH = 45;
    const N_SAMPLES = 1000;

    async function costruisciCircuito(scene, trackData, opzioni) {
        const o = opzioni || {};
        // ⚠️ TrackMeshBuilder NON si può richiedere qui: usa `window` e in Node
        // esplode all'import (verificato: «window is not defined»). Quindi si
        // prende dal global quando si è nel browser, e nei test lo passa il
        // chiamante — che è anche ciò che rende verificabile la sequenza.
        const builder = o.builder || glob.TrackMeshBuilder;
        if (!builder) throw new Error('TrackMeshBuilder non disponibile: caricalo prima di f1Scena');
        const passo = o.passo || function () {};
        const respira = o.respira || (async function () {});
        const gridSize = o.gridSize || 6;

        const roadHalf = trackData.roadHalfWidth;
        const barrierDist = roadHalf + CURB_W + 1.2;
        // Il terrapieno deve iniziare esattamente dal bordo esterno del cordolo
        // (non da barrierDist, che è 1.2 unità più in là, dove sta la
        // barriera): altrimenti resta scoperta una fascia sottile fra cordolo e
        // barriera — prima invisibile perché il prato piatto infinito copriva
        // tutto, ora che il prato parte dal terrapieno si vedrebbe il cielo.
        const embankmentStart = roadHalf + CURB_W;

        // ⚠️ `campionaPista` e non `sampleLoop`: e' la stessa funzione con cui
        // il server costruisce i suoi campioni, e ci mette dentro i giri della
        // morte. Campionandosi la pista per conto suo, il client disegnerebbe
        // un circuito senza tubi mentre la fisica ne percorre uno che ce li ha.
        const trackPts = TrackAcrobatico.campionaPista(trackData, N_SAMPLES);
        // Aggancia il primo/ultimo punto della corsia box al bordo pista vero,
        // con la stessa funzione che usa il server (trackLoader.js::buildTrack)
        // sugli stessi punti grezzi: il disegno corrisponde ESATTAMENTE alla
        // posizione fisica reale dell'auto in uscita dai box.
        const pitPath = TrackGeometry.snapPitPathEnds(trackData.pit.path, trackPts, roadHalf);
        const pitPts = TrackGeometry.tuckPitEndsToTrack(
            TrackGeometry.sampleOpenPath(pitPath, 300), trackPts);

        // Dove sta il bordo del circuito: barriera e vie di fuga, calcolate UNA
        // volta e riusate per la banda di ghiaia disegnata, per la posizione
        // delle barriere e per traslare la scenografia. Il server ne calcola
        // uno identico con la stessa funzione per il muro fisico — stessi
        // input, stesso risultato, nessun rischio di divergenza.
        //
        // ⚠️ Va calcolato PRIMA di costruire il terreno: il pianoro deve
        // arrivare fino alla barriera, e la barriera la decide questo profilo.
        const barrierProfile = TrackGravel.barrierProfile(trackPts, {
            roadHalf,
            curbW: CURB_W,
            pitLanePts: pitPts,
            pitRoadHalf: trackData.pit.roadHalfWidth,
            citta: trackData.ambientazione === 'citta',
        });

        // Fin dove il terreno resta alla quota della pista, e dove ha finito di
        // degradare al prato in piano. Il pianoro arriva alla barriera più
        // lontana del giro: con la via di fuga la barriera sta ben oltre il
        // vecchio embankmentStart, e lasciandolo com'era nelle zone
        // sopraelevate il muro restava sospeso sul pendio e le tribune si
        // piantavano più in basso della pista. La stessa distanza la ricava da
        // sé TrackScenery.generateLayout dal profilo, quindi terreno disegnato
        // e oggetti piazzati concordano.
        const embankPlateau = TrackScenery.embankmentStart(barrierProfile, embankmentStart);
        const embankOuter = embankPlateau + EMBANKMENT_WIDTH;

        passo('Terreno e dislivelli…', 0.20);
        await respira();

        // ⚠️ Il terreno si costruisce sui punti A TERRA, non su tutti: un giro
        // della morte è sospeso nel vuoto, e passandogli i campioni del tubo il
        // prato saliva con loro — una collina verde alta cinquanta unità che
        // riempiva il loop, vista alla prima prova headless del 2026-08-26.
        // Sotto un ponte invece il terreno c'è, ed è per questo che serve la
        // lista senza ponti E senza tubi: sono entrambi «pista senza terra
        // sotto», e la quota del suolo lì la decide il territorio attorno.
        // ── L'AMBIENTAZIONE decide che mondo c'è attorno alla pista ──
        // Verde: prato, colline, boschi, come è sempre stato. Città: asfalto
        // fino alle facciate, e niente rilievi — dietro un muro di palazzi non
        // si vedrebbero comunque, e ogni collina è schermo riempito per niente.
        const inCitta = trackData.ambientazione === 'citta';
        builder.impostaSuolo(inCitta ? ToonPalette.SURFACES.cittaSuolo : undefined);
        SceneryHills.impostaColline(!inCitta);

        const puntiATerra = trackPts.filter(p => !p.bridge && !p.acrobatico);
        const primaDelPrato = scene.children.length;
        builder.buildGround(scene, puntiATerra, embankOuter, 3000, embankPlateau);
        // buildGround non restituisce le sue mesh: si prendono per differenza.
        // Servono al gioco, che le stilizza a parte (il prato dipinto).
        const mesheTerreno = scene.children.slice(primaDelPrato);
        // Tre distanze: attacco alla pista, fine del pianoro, fine della rampa.
        builder.buildEmbankment(scene, puntiATerra, embankmentStart, embankPlateau, embankOuter);
        // Punti "a terra" (non-ponte): usati sia per i piloni (quota reale
        // sotto un ponte) sia per la quota visiva fuori pista — calcolati una
        // sola volta qui, non ad ogni frame.
        const groundPts = puntiATerra;
        // Ultimo argomento: la barriera VERA del tratto che passa sotto il
        // viadotto. Senza, i piloni si tenevano alla larga da una distanza
        // costante che le vie di fuga hanno reso obsoleta, e su "prova" quattro
        // finivano dentro la carreggiata.
        builder.buildBridgeDecks(scene, trackPts, groundPts, roadHalf + CURB_W,
            embankmentStart, embankPlateau, embankOuter,
            (i, lato) => TrackGravel.barrierAt(barrierProfile, i, lato));

        // Calcolato una volta sola: cordolo, barriera disegnata e MURO FISICO
        // lato server devono aprire il varco esattamente nello stesso punto e
        // nella stessa forma. La regola sta in TrackGravel, e il server la
        // richiama sugli stessi punti, così i due varchi non possono divergere.
        //
        // Solo i campioni vicino ai due estremi della corsia, non tutti: il
        // varco deve aprirsi SOLO al vero ingresso/uscita, non ovunque il
        // tracciato passi vicino a un punto qualunque della corsia box (bug
        // reale misurato in playtest: 139 m di varco spurio su "prova").
        const pitMergeSamples = TrackGravel.pitGapSamples(pitPts);

        passo('Asfalto, cordoli e barriere…', 0.30);
        await respira();

        // Da qui in avanti nascono le superfici che di notte stanno SOTTO le
        // torri faro — asfalto, cordoli, ghiaia. Si segna dove comincia la
        // lista per poterle stilizzare a parte, con la tinta notturna dei
        // tratti illuminati invece di quella del buio: è il nastro chiaro che
        // taglia la notte, e senza il circuito è solo una scena scura.
        const primaDelleSuperfici = scene.children.length;

        // DoubleSide evita artefatti di culling nelle zone ad alta curvatura.
        builder.buildRibbon(scene, trackPts, roadHalf, new THREE.MeshStandardMaterial({
            color: ToonPalette.SURFACES.asphalt, roughness: 0.95, side: THREE.DoubleSide,
        }));
        builder.buildCurbs(scene, trackPts, roadHalf, CURB_W, pitMergeSamples);
        // Vie di fuga in ghiaia, dopo il cordolo e prima della barriera:
        // l'ordine delle chiamate riflette la sezione reale della pista. La
        // banda parte dal bordo esterno del cordolo, quindi non si sovrappone
        // a nessuno dei due.
        builder.buildGravel(scene, trackPts, roadHalf, CURB_W, barrierProfile.gravel);
        const mesheSuperfici = scene.children.slice(primaDelleSuperfici);

        // La barriera sta dove dice il profilo: arretrata della via di fuga
        // minima quasi ovunque, di più dove c'è la ghiaia, ferma dov'era nel
        // tratto del traguardo e dei box, a bordo strada sui ponti.
        // Il piede va posato sul TERRENO, non sulla quota della pista: in curva
        // mentre si sale i settori del terrapieno si accavallano e quello più
        // avanti, più alto, seppellirebbe la barriera di quello più indietro.
        builder.buildBarriers(scene, trackPts,
            (i, side) => TrackGravel.barrierAt(barrierProfile, i, side),
            pitMergeSamples,
            (i, bx, bz) => TrackGeometry.terrainTopAt(trackPts, i, bx, bz, embankPlateau),
            { sponsor: inCitta });
        // LA CITTÀ, dopo le barriere perché si posa su di loro: la facciata
        // comincia dove finisce il muro più il marciapiede, e dove la via di
        // fuga allarga arretra con lei.
        // Il traguardo serve gia' qui e non solo alla griglia: in citta' e' uno
        // dei due tratti attorno a cui i palazzi stanno larghi, per non murare
        // il podio e la torre di controllo.
        const startFinishIndex = trackData.startFinish
            ? TrackGeometry.nearestPoint(trackPts, trackData.startFinish.x, trackData.startFinish.z).index
            : 0;
        if (inCitta) {
            builder.buildCitta(scene, trackPts,
                CittaProfilo.perPista(trackData, trackPts, barrierProfile, pitPts));
        }
        builder.buildStartLine(scene, trackPts, roadHalf);
        // drawBoxMarker=false: in gara ogni pilota ha il proprio box 3D
        // colorato, che prende il posto del riquadro giallo unico. Resta true
        // di default per l'editor tracciato.
        builder.buildPitLane(scene, pitPath, trackData.pit.roadHalfWidth, trackData.pit.boxIndex,
            false, trackPts, ToonPalette.SURFACES.asphalt, roadHalf, CURB_W);

        // Griglia di partenza vera, permanente sulla pista (visibile sia in
        // qualifica sia in gara): indice campionato più vicino al traguardo
        // esplicito se la pista ne ha uno, altrimenti 0. Quante piazzole
        // dipingere non è un dato geometrico ma il numero di piloti scelto in
        // lobby.
        builder.buildStartingGrid(scene, trackPts, startFinishIndex, gridSize);

        return {
            trackPts, groundPts, pitPath, pitPts, barrierProfile,
            embankPlateau, embankOuter, startFinishIndex,
            mesheTerreno, mesheSuperfici,
            roadHalf, curbW: CURB_W, barrierDist, embankmentStart, pitMergeSamples,
        };
    }

    return { costruisciCircuito, CURB_W, EMBANKMENT_WIDTH, N_SAMPLES };
});
