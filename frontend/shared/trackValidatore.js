// frontend/shared/trackValidatore.js
//
// COSA C'È CHE NON VA IN QUESTA PISTA — detto mentre la si disegna, non
// scoperto in gara.
//
// PERCHÉ ESISTE. `nuova-pista`, disegnata in dieci minuti col nuovo editor,
// aveva tre difetti che nessuno ha detto all'autore: i bot non completavano il
// giro, non entravano ai box, e la tribuna principale aveva zero moduli su
// dodici. Tutti e tre li ha trovati un test, ore dopo.
//
// ⚠️ E il terzo insegna come vanno scritti questi controlli: la prima
// spiegazione — «il traguardo è in curva» — era sbagliata, prodotta da una
// misura con la finestra in campioni invece che in unità di pista. Un
// controllo DIRETTO sul difetto («la tribuna principale è vuota») vale più di
// un controllo indiretto su una causa presunta: si accorge del guaio anche
// quando la causa è un'altra.
// Rif. docs/superpowers/specs/2026-08-24-f1-validatore-pista-design.md
//
// ⚠️ UN DIFETTO È DEFINITO UNA VOLTA SOLA. Le misure che stanno qui sono le
// stesse che usano le invarianti di scenografia: se ne esistessero due copie,
// un giorno il test direbbe una cosa e il pulsante un'altra.
//
// IL VALIDATORE DICE, NON AGGIUSTA: un editor che sposta le cose da solo
// mentre disegni è peggio del difetto che voleva curare.
//
// Modulo PURO: niente Three.js, niente DOM.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./trackGeometry.js'), require('./trackGravel.js'),
                                 require('./sceneryAssetSizes.js'), require('./sceneryRegistro.js'));
    } else {
        root.TrackValidatore = factory(root.TrackGeometry, root.TrackGravel,
                                       root.SceneryAssetSizes, root.SceneryRegistro);
    }
})(typeof self !== 'undefined' ? self : this, function (TrackGeometry, TrackGravel, SceneryAssetSizes, SceneryRegistro) {

    // --- Le soglie, e da dove vengono ------------------------------------
    // Misurate sulle piste esistenti il 2026-08-24, non scelte a naso.

    // Raggio minimo, in MEZZE CARREGGIATE e non in unità: una pista larga il
    // doppio ha bisogno del doppio di raggio per la stessa curva, e una soglia
    // in unità direbbe cose diverse su piste diverse.
    // Misurato: melbourne 1.7, suzuka 2.0, prova 2.9, monte-rosso 4.4.
    // ⚠️ Sotto questa soglia NON si impedisce di salvare: melbourne è la più
    // stretta di tutte e i bot la completano. Il raggio da solo non predice.
    const RAGGIO_MINIMO_IN_MEZZE_CARREGGIATE = 1.5;

    // Oltre, in gara la macchina non tiene la traiettoria.
    const PENDENZA_MASSIMA = 15;   // percento

    // Il traguardo vuole un tratto dritto: la tribuna principale è una fila di
    // dodici moduli larghi 19.2, cioè ~230 unità, e in curva non ci sta.
    // Misurato con la finestra qui sotto: la più stretta fra le piste
    // esistenti è `prova` con 70, tutte le altre stanno fra 131 e 9522.
    const RAGGIO_MINIMO_TRAGUARDO = 60;
    // ⚠️ FINESTRA E PASSO IN UNITÀ DI PISTA, mai in campioni. Con una finestra
    // in campioni la stessa soglia varrebbe 94 unità su monte-rosso e 413 su
    // prova, cioè misurerebbe cose diverse su piste diverse — e infatti la
    // prima versione di questo controllo dava a `nuova-pista` il raggio più
    // ALTO di tutti (5557) proprio dove il difetto c'era.
    const META_TRIBUNA = 115;      // mezza fila di tribuna principale
    const PASSO_CURVA = 20;        // fra i tre punti che definiscono il raggio

    // Oltre questo scarto il traguardo punta dalla parte sbagliata: i bot
    // partono e fanno subito testacoda per raddrizzarsi.
    const SCARTO_MASSIMO_TRAGUARDO = Math.PI / 2;

    const GIRO_CORTO = 800;        // unità

    const N_CAMPIONI = 500;        // per le misure: 1000 non cambia i numeri

    function problema(livello, codice, messaggio, dove) {
        return { livello, codice, messaggio, dove: dove || null };
    }

    // Raggio del cerchio per tre punti: R = (abc) / (4·area). Su punti
    // distanziati di `passo` campioni, non consecutivi — a passo 1 il rumore
    // del campionamento domina e ogni pista sembra piena di tornanti.
    function raggioAl(pts, i, passo) {
        const n = pts.length;
        const A = pts[(i - passo + n) % n], B = pts[i], C = pts[(i + passo) % n];
        const areaDoppia = Math.abs((B.x - A.x) * (C.z - A.z) - (C.x - A.x) * (B.z - A.z));
        if (areaDoppia < 1e-9) return Infinity;
        const la = Math.hypot(C.x - B.x, C.z - B.z);
        const lb = Math.hypot(C.x - A.x, C.z - A.z);
        const lc = Math.hypot(B.x - A.x, B.z - A.z);
        return (la * lb * lc) / (2 * areaDoppia);
    }

    function raggioMinimo(pts, passo) {
        let minimo = Infinity, dove = 0;
        for (let i = 0; i < pts.length; i++) {
            const r = raggioAl(pts, i, passo);
            if (r < minimo) { minimo = r; dove = i; }
        }
        return { raggio: minimo, indice: dove };
    }

    function dentroIlRiquadro(x, z, box) {
        return TrackGeometry.pointInOrientedBox(x, z, box);
    }

    function angoliDelRiquadro(box) {
        const c = Math.cos(box.angle || 0), s = Math.sin(box.angle || 0);
        return [[-box.halfWidth, -box.halfLength], [box.halfWidth, -box.halfLength],
                [box.halfWidth, box.halfLength], [-box.halfWidth, box.halfLength]]
            .map(([dx, dz]) => ({ x: box.x + dx * c + dz * s, z: box.z - dx * s + dz * c }));
    }

    // --- Il controllo -----------------------------------------------------
    function controllaGeometria(trackData) {
        const problemi = [];
        const aggiungi = (...args) => problemi.push(problema(...args));

        const punti = (trackData && trackData.controlPoints) || [];
        if (punti.length < 3) {
            aggiungi('impedisce', 'pochi-punti',
                `Il tracciato ha ${punti.length} punti: ne servono almeno 3, altrimenti il gioco non lo carica.`);
            return { problemi };   // senza tracciato non ha senso misurare altro
        }

        const mezza = trackData.roadHalfWidth || 11;
        const pts = TrackGeometry.sampleLoop(punti, N_CAMPIONI);
        const giro = TrackGeometry.lapLength(pts);

        if (giro < GIRO_CORTO) {
            aggiungi('da sapere', 'giro-corto',
                `Il giro è di ${giro.toFixed(0)} unità: molto corto, si passerà spesso dal traguardo.`);
        }

        // --- Curve ---
        // Il passo è in UNITÀ di pista: a passo fisso in campioni, su una
        // pista lunga i tre punti si allontanano tanto da attraversare la
        // curva e vederla dritta.
        const perUnita = N_CAMPIONI / giro;
        const passoCurva = Math.max(2, Math.round(PASSO_CURVA * perUnita));
        const stretta = raggioMinimo(pts, passoCurva);
        const sogliaRaggio = mezza * RAGGIO_MINIMO_IN_MEZZE_CARREGGIATE;
        if (stretta.raggio < sogliaRaggio) {
            aggiungi('da guardare', 'curva-stretta',
                `La curva più stretta ha raggio ${stretta.raggio.toFixed(0)}, meno di ${sogliaRaggio.toFixed(0)}`
                + ` (una volta e mezza la mezza carreggiata): si percorrerà quasi a passo d'uomo.`,
                { x: pts[stretta.indice].x, z: pts[stretta.indice].z });
        }

        // --- Pendenze ---
        let pendenzaMax = 0, dovePendenza = 0;
        for (let i = 0; i < pts.length; i++) {
            const a = pts[i], b = pts[(i + 1) % pts.length];
            const orizzontale = Math.hypot(b.x - a.x, b.z - a.z);
            if (orizzontale < 1e-6) continue;
            const p = Math.abs(((b.y || 0) - (a.y || 0)) / orizzontale) * 100;
            if (p > pendenzaMax) { pendenzaMax = p; dovePendenza = i; }
        }
        if (pendenzaMax > PENDENZA_MASSIMA) {
            aggiungi('da guardare', 'pendenza-forte',
                `Pendenza massima ${pendenzaMax.toFixed(0)}%, oltre il ${PENDENZA_MASSIMA}%:`
                + ` lì la macchina fatica a tenere la traiettoria.`,
                { x: pts[dovePendenza].x, z: pts[dovePendenza].z });
        }

        // --- Traguardo ---
        const iTraguardo = trackData.startFinish
            ? TrackGeometry.nearestPoint(pts, trackData.startFinish.x, trackData.startFinish.z).index
            : 0;
        // Il raggio più stretto lungo tutto il tratto che la tribuna occuperebbe,
        // non quello del solo punto del traguardo: la fila è lunga, e basta
        // che si stringa a un capo perché non ci stia.
        const finestraTribuna = Math.max(2, Math.round(META_TRIBUNA * perUnita));
        let raggioTraguardo = Infinity;
        for (let d = -finestraTribuna; d <= finestraTribuna; d++) {
            const i = ((iTraguardo + d) % pts.length + pts.length) % pts.length;
            const r = raggioAl(pts, i, passoCurva);
            if (r < raggioTraguardo) raggioTraguardo = r;
        }
        if (raggioTraguardo < RAGGIO_MINIMO_TRAGUARDO) {
            aggiungi('da guardare', 'traguardo-in-curva',
                `Il traguardo è dentro una curva (raggio ${raggioTraguardo.toFixed(0)}):`
                + ` la tribuna principale è una fila dritta e lì non ci starà.`,
                { x: pts[iTraguardo].x, z: pts[iTraguardo].z });
        }
        if (trackData.startFinish && typeof trackData.startFinish.angle === 'number') {
            const t = TrackGeometry.tangentAt(pts, iTraguardo, true);
            const vero = Math.atan2(t.tx, t.tz);
            const scarto = Math.abs(Math.atan2(Math.sin(trackData.startFinish.angle - vero),
                                               Math.cos(trackData.startFinish.angle - vero)));
            if (scarto > SCARTO_MASSIMO_TRAGUARDO) {
                aggiungi('impedisce', 'traguardo-contromano',
                    `Il traguardo punta a ${(scarto * 180 / Math.PI).toFixed(0)}° dal verso in cui la pista corre:`
                    + ` alla partenza i bot faranno testacoda per raddrizzarsi. Premi «Allinea al verso della pista».`,
                    { x: pts[iTraguardo].x, z: pts[iTraguardo].z });
            }
        }

        // --- Corsia box ---
        const pit = trackData.pit || {};
        const corsia = pit.path || [];
        if (corsia.length < 3) {
            aggiungi('impedisce', 'corsia-corta',
                `La corsia box ha ${corsia.length} punti: ne servono almeno 3.`);
        } else {
            if (!Number.isInteger(pit.boxIndex) || pit.boxIndex < 0 || pit.boxIndex >= corsia.length) {
                aggiungi('impedisce', 'casella-box-fuori',
                    `La casella del box è ${pit.boxIndex}, fuori dai ${corsia.length} punti della corsia.`);
            }
            const trigger = pit.entryTrigger;
            if (!trigger || !(trigger.halfWidth > 0) || !(trigger.halfLength > 0)) {
                aggiungi('impedisce', 'trigger-mancante',
                    `Manca il riquadro d'ingresso ai box, o ha misure non valide.`);
            } else {
                if (!corsia.some(p => dentroIlRiquadro(p.x, p.z, trigger))) {
                    aggiungi('impedisce', 'trigger-non-tocca',
                        `Il riquadro d'ingresso non tocca nessun punto della corsia box:`
                        + ` nessuno entrerà mai ai box. Usa «Posizionalo tu».`,
                        { x: trigger.x, z: trigger.z });
                }
                // Chi ci passa dentro va ai box: se sborda sull'asfalto, ci
                // finisce anche chi sta solo passando a tutta velocità.
                const sborda = angoliDelRiquadro(trigger)
                    .some(a => TrackGeometry.nearestPoint(pts, a.x, a.z).dist < mezza);
                if (sborda) {
                    aggiungi('da guardare', 'trigger-sull-asfalto',
                        `Il riquadro d'ingresso sconfina sulla carreggiata: manderà ai box anche chi passa dritto.`,
                        { x: trigger.x, z: trigger.z });
                }
            }
        }

        return { problemi };
    }

    // --- Scenografia -----------------------------------------------------
    //
    // ⚠️ QUESTE MISURE SONO QUELLE DELLE INVARIANTI: `scenografiaInvarianti.test.js`
    // usa questa funzione invece delle proprie, così la definizione di
    // «oggetto dentro la pista» è una sola. Se ce ne fossero due, un giorno il
    // test direbbe una cosa e il pulsante un'altra — e a quel punto non si sa
    // più a chi credere.
    //
    // Serve un `layout` già generato (da TrackScenery.generateLayout): questo
    // modulo resta puro e non genera niente, così chi lo chiama decide se
    // pagare quel secondo di calcolo.

    // Categorie senza un modello solido: non hanno un ingombro da rispettare.
    const NON_SOLIDE = new Set(['pond', 'parkingLot', 'crowd']);

    // A che distanza dal centro di una tribuna può stare uno spettatore prima
    // di essere «a mezz'aria»: una tribuna è 19.2 x 12.8, quindi dal centro
    // nessun sedile dista di più.
    const RAGGIO_TRIBUNA = 15;

    function dentroIlCorridoio(item, punti, mezzaLarghezza) {
        if (!punti || !punti.length) return 0;
        let peggio = 0;
        for (const c of SceneryAssetSizes.footprintCorners(item)) {
            const dentro = mezzaLarghezza - TrackGeometry.nearestPoint(punti, c.x, c.z).dist;
            if (dentro > peggio) peggio = dentro;
        }
        return peggio;
    }

    // Quanto un ingombro entra oltre il muro, cioè dentro la via di fuga. Il
    // muro non è a distanza fissa: si chiede dov'è al campione più vicino a
    // OGNI angolo, perché si allarga in curva.
    function dentroLaViaDiFuga(item, trackPts, barrierProfile, barrierDist) {
        let peggio = 0;
        for (const c of SceneryAssetSizes.footprintCorners(item)) {
            const near = TrackGeometry.nearestPoint(trackPts, c.x, c.z);
            const p = trackPts[near.index];
            const n = TrackGeometry.normalAt(trackPts, near.index, true);
            const lato = Math.sign((c.x - p.x) * n.nx + (c.z - p.z) * n.nz) || 1;
            const muro = barrierProfile
                ? TrackGravel.barrierAt(barrierProfile, near.index, lato)
                : barrierDist;
            const d = muro - near.dist;
            if (d > peggio) peggio = d;
        }
        return peggio;
    }

    function controllaScenografia(trackData, layout, contesto) {
        const problemi = [];
        const aggiungi = (...args) => problemi.push(problema(...args));
        if (!layout || !layout.length) return { problemi };

        const c = contesto || {};
        const trackPts = c.trackPts;
        const pitPts = c.pitPts;
        const mezza = trackData.roadHalfWidth;
        const solidi = layout.filter(v => v.asset && !NON_SOLIDE.has(v.category));

        // 1. Dentro la CARREGGIATA: non ci va niente, punto.
        const inPista = solidi
            .filter(v => !SceneryRegistro.SCAVALCANO.has(v.asset))
            .map(v => ({ v, p: dentroIlCorridoio(v, trackPts, mezza) }))
            .filter(x => x.p > SceneryRegistro.MAX_DENTRO_PISTA);
        if (inPista.length) {
            const peggio = inPista.sort((a, b) => b.p - a.p)[0];
            aggiungi('impedisce', 'oggetti-in-pista',
                `${inPista.length} ${inPista.length === 1 ? 'oggetto è' : 'oggetti sono'} dentro la carreggiata`
                + ` (il peggiore: ${peggio.v.asset}, dentro di ${peggio.p.toFixed(1)} unità).`,
                { x: peggio.v.x, z: peggio.v.z });
        }

        // 2. Dentro la VIA DI FUGA: per chi guida è pista anche quella. Esente
        //    chi ci sta per mestiere (pile di gomme, cartelli di frenata).
        const inFuga = solidi
            .filter(v => !SceneryRegistro.SCAVALCANO.has(v.asset) && !SceneryRegistro.A_BORDO_PISTA.has(v.category))
            .map(v => ({ v, p: dentroLaViaDiFuga(v, trackPts, c.barrierProfile, c.barrierDist) }))
            .filter(x => x.p > SceneryRegistro.MAX_DENTRO_PISTA);
        if (inFuga.length) {
            const peggio = inFuga.sort((a, b) => b.p - a.p)[0];
            aggiungi('da guardare', 'oggetti-in-via-di-fuga',
                `${inFuga.length} ${inFuga.length === 1 ? 'oggetto sta' : 'oggetti stanno'} fra il muro e l'asfalto`
                + ` (il peggiore: ${peggio.v.asset}).`,
                { x: peggio.v.x, z: peggio.v.z });
        }

        // 3. Dentro la CORSIA BOX: i garage la lambiscono per mestiere, il
        //    resto no.
        if (pitPts && pitPts.length && trackData.pit) {
            const inBox = solidi
                .filter(v => !SceneryRegistro.SCAVALCANO.has(v.asset))
                .map(v => ({ v, p: dentroIlCorridoio(v, pitPts, trackData.pit.roadHalfWidth) }))
                .filter(x => x.p > SceneryRegistro.MAX_DENTRO_BOX);
            if (inBox.length) {
                const peggio = inBox.sort((a, b) => b.p - a.p)[0];
                aggiungi('da guardare', 'oggetti-in-corsia-box',
                    `${inBox.length} ${inBox.length === 1 ? 'oggetto è' : 'oggetti sono'} dentro la corsia box`
                    + ` (il peggiore: ${peggio.v.asset}).`,
                    { x: peggio.v.x, z: peggio.v.z });
            }
        }

        // 4. Spettatori senza la loro tribuna: la folla nasce prima della
        //    porta della scenografia, e se la tribuna viene scartata dopo,
        //    restano seduti nel vuoto.
        const sorgenti = layout.filter(v => v.category === 'grandstand' || v.category === 'grandstand-main'
            || v.asset === 'hospitalityDeck' || v.asset === 'vipSuite');
        const orfani = layout.filter(v => v.category === 'crowd')
            .filter(s => !sorgenti.some(g => Math.hypot(g.x - s.x, g.z - s.z) < RAGGIO_TRIBUNA));
        if (orfani.length) {
            aggiungi('da guardare', 'spettatori-a-mezz-aria',
                `${orfani.length} spettatori sono seduti dove non c'è nessuna tribuna.`,
                { x: orfani[0].x, z: orfani[0].z });
        }

        // 5. Tribuna principale vuota. È il controllo DIRETTO sul difetto:
        //    prende il guaio quale che sia la causa — e su `nuova-pista` la
        //    causa non era quella che sembrava.
        const moduliPrincipali = layout.filter(v => v.category === 'grandstand-main').length;
        if (!moduliPrincipali) {
            aggiungi('da guardare', 'niente-tribuna-principale',
                `Il traguardo non ha la sua tribuna: nessun modulo ha trovato posto.`
                + ` Di solito vuol dire che lì non c'è un tratto abbastanza dritto e libero.`,
                trackData.startFinish ? { x: trackData.startFinish.x, z: trackData.startFinish.z } : null);
        }

        return { problemi };
    }

    return {
        controllaGeometria, controllaScenografia,
        dentroIlCorridoio, dentroLaViaDiFuga, NON_SOLIDE, RAGGIO_TRIBUNA,
        raggioMinimo, raggioAl,
        RAGGIO_MINIMO_IN_MEZZE_CARREGGIATE, PENDENZA_MASSIMA,
        RAGGIO_MINIMO_TRAGUARDO, SCARTO_MASSIMO_TRAGUARDO, GIRO_CORTO,
        META_TRIBUNA, PASSO_CURVA,
    };
});
