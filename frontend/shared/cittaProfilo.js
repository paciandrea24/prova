// frontend/shared/cittaProfilo.js
//
// DOVE STA LA FACCIATA E QUANTO È ALTO OGNI PALAZZO.
//
// ⚠️ LA CITTÀ NON È FATTA DI EDIFICI, È UN NASTRO. Prendere N modelli di
// palazzo e disporli lungo il bordo ha due difetti che non si curano: la curva
// (un edificio è un parallelepipedo, il tracciato gira — ogni giunzione diventa
// uno spigolo aperto o una compenetrazione) e il costo, perché questo gioco è
// GPU-bound sui pixel e un muro che chiude la vista è esattamente ciò che
// riempie lo schermo. La facciata si estrude sul tracciato come già fanno
// asfalto, cordoli e barriere: segue la curva PER COSTRUZIONE.
//
// Qui si decide soltanto: a che distanza dall'asse comincia, quanto è alta, di
// che colore. La mesh la costruisce TrackMeshBuilder.buildCitta leggendo questo
// — la stessa separazione che nel banking ha tenuto insieme mesh, fisica e
// camera, e che qui rende la città provabile con `node --test` invece che a
// occhio.
// Rif. docs/superpowers/specs/2026-08-26-f1-ambientazione-cittadina-design.md
//
// Modulo PURO: niente Three.js, niente DOM.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./trackGravel.js'), require('./trackGeometry.js'),
                                 require('./trackScenery.js'), require('./toonPalette.js'));
    } else {
        root.CittaProfilo = factory(root.TrackGravel, root.TrackGeometry, root.TrackScenery, root.ToonPalette);
    }
})(typeof self !== 'undefined' ? self : this, function (TrackGravel, TrackGeometry, TrackScenery, ToonPalette) {

    // Quanto marciapiede sta fra il muro e la prima facciata.
    //
    // ⚠️ NON E' UNA MISURA DI GUSTO: e' quanto sporge, oltre il muro, la roba
    // che sta a bordo pista e che deve restare DAVANTI ai palazzi. Misurato su
    // citta-prova: la tribuna coperta arriva a 20.6, quella scoperta a 17.5, la
    // torretta commissari a 10.3, le pile di gomme a 4.5. Con le sei unita' di
    // partenza — «a Monaco fra il guard-rail e le case ci sta giusto la gente in
    // piedi» — le tribune finivano dentro le facciate: 87 tribune tagliate a
    // meta' da un muro di mattoni.
    //
    // Abbassarlo si puo', ma non da solo: prima devono restare fuori le tribune.
    const MARCIAPIEDE = 22;

    // Un palazzo più basso della carreggiata non chiude niente; oltre i 45 si
    // vede solo muro anche dall'abitacolo, e ogni unità in più è schermo
    // riempito — che su questo gioco è il costo che conta davvero.
    const ALTEZZA_MIN = 14;
    const ALTEZZA_MAX = 45;

    // Quanto è lungo un palazzo, in unità di pista. Sotto le 25 la fila si legge
    // come una scalinata, sopra le 60 come un capannone unico.
    const PALAZZO_LUNGHEZZA = 38;

    // ⚠️ QUANTO SPAZIO VUOLE IL PADDOCK. Nel tratto del traguardo il muro della
    // pista non arretra: sta FRA la carreggiata e la corsia box, com'è giusto.
    // Una facciata posata su quel muro più il marciapiede cade quindi in mezzo
    // alla corsia e dentro i garage — è il difetto che l'utente ha visto per
    // primo, «si entra attraverso edifici», e che si misura: su citta-prova 260
    // punti di corsia su 300 stavano dentro un palazzo.
    //
    // Il numero non è nuovo: la fila dei garage la posa TrackScenery a
    // `pitRoadHalf + PIT_BUILDING_OFFSET_MARGIN` dall'asse della corsia, e
    // l'edificio è profondo 14.7 — il suo retro sta altre 7.4 unità più in là.
    // Una misura sola per due sistemi: se un giorno i garage si spostano, la
    // città arretra con loro invece di scoprirlo al playtest.
    const PADDOCK_RETRO = 7.4;
    const PADDOCK = TrackScenery.PIT_BUILDING_OFFSET_MARGIN + PADDOCK_RETRO;

    // Di quanto la facciata può allontanarsi dall'asse da un campione al
    // successivo, in frazione del passo. Senza limite, il rientro attorno ai box
    // sarebbe un salto secco di trenta unità: il nastro resterebbe continuo, ma
    // si vedrebbe una parete piatta perpendicolare alla strada. È la stessa cura
    // (e lo stesso valore) con cui trackGravel livella il muro.
    const PENDENZA_MAX = 1.0;

    // ⚠️ E NEL TRATTO DEL TRAGUARDO LA CITTA' STA LARGA DA TUTTE E DUE LE PARTI.
    // Il muro della pista fa gia' cosi' («la zona protegge entrambi i lati, non
    // solo quello dei box»), e per la stessa ragione: li' c'e' il podio, che
    // sporge 33.6 unita' oltre il muro, la torre di controllo a 26.3, e in G2
    // ci andra' il lusso che l'utente ha chiesto attorno ai box. Senza questa
    // regola il podio finiva murato nella facciata del lato opposto ai garage.
    const LUSSO_TRAGUARDO = 40;

    // Le tinte delle facciate, dalla palette: un colore scritto a mano qui è un
    // colore che un giorno divergerà dal resto della scena.
    function tinte() {
        return ToonPalette.CITTA_FACCIATE;
    }

    // Fin dove la città deve stare indietro perché il paddock ci stia: zero
    // quasi ovunque, decine di unità nel tratto dei box.
    //
    // Si guarda la corsia box PUNTO PER PUNTO e la si proietta sulla normale
    // del campione più vicino: così il conto vale anche sul raccordo curvo
    // dell'ingresso, che si stacca dalla pista in obliquo ed è proprio il punto
    // in cui l'utente ha visto la corsia infilarsi dentro i palazzi.
    function spazioPerIlPaddock(trackPts, barrierProfile, opzioni, passo) {
        const n = trackPts.length;
        const arretra = new Float64Array(n * 2);
        const pit = opzioni.pitLanePts;
        if (!pit || !pit.length) return arretra;
        const pitHalf = opzioni.pitRoadHalf || 0;

        for (const q of pit) {
            const i = TrackGeometry.nearestPoint(trackPts, q.x, q.z).index;
            const nrm = TrackGeometry.normalAt(trackPts, i, true);
            const proj = (q.x - trackPts[i].x) * nrm.nx + (q.z - trackPts[i].z) * nrm.nz;
            const k = i * 2 + (proj >= 0 ? 0 : 1);
            const serve = Math.abs(proj) + pitHalf + PADDOCK;
            if (serve > arretra[k]) arretra[k] = serve;
        }

        // I DUE TRATTI CHE STANNO LARGHI DA TUTTE E DUE LE PARTI: quello dei
        // box e quello del traguardo. Non sono lo stesso posto — su citta-prova
        // il podio dista 210 unità dalla corsia — e il muro della pista ne
        // conosce uno solo, perché a lui interessa solo dove passa la corsia.
        //
        // La finestra attorno alla corsia è la STESSA del muro
        // (TrackGravel.PIT_STRAIGHT_REACH): due misure diverse di «dove comincia
        // il tratto dei box» vorrebbero dire due mondi che finiscono in punti
        // diversi. Attorno al traguardo si usa la stessa lunghezza, misurata in
        // unità di pista e non in campioni (un campione vale 1.18 unità su
        // monte-rosso e 5.17 su prova).
        const sf = Number.isFinite(opzioni.startFinishIndex) ? opzioni.startFinishIndex : null;
        for (let i = 0; i < n; i++) {
            const p = trackPts[i];
            let dentro = TrackGeometry.nearestPoint(pit, p.x, p.z).dist < TrackGravel.PIT_STRAIGHT_REACH;
            if (!dentro && sf !== null) {
                const avanti = ((i - sf) % n + n) % n;
                const giro = Math.min(avanti, n - avanti) * passo;
                dentro = giro < TrackGravel.PIT_STRAIGHT_REACH;
            }
            if (!dentro) continue;
            const muroDx = TrackGravel.barrierAt(barrierProfile, i, 1);
            const muroSx = TrackGravel.barrierAt(barrierProfile, i, -1);
            if (muroDx + LUSSO_TRAGUARDO > arretra[i * 2]) arretra[i * 2] = muroDx + LUSSO_TRAGUARDO;
            if (muroSx + LUSSO_TRAGUARDO > arretra[i * 2 + 1]) arretra[i * 2 + 1] = muroSx + LUSSO_TRAGUARDO;
        }

        // La rientranza si apre e si chiude con una pendenza, non a scalino, e
        // riempie i campioni che nessun punto della corsia ha toccato. Due
        // passate per verso perché l'anello è chiuso: la prima porta il valore
        // fino in fondo, la seconda gli fa scavalcare il campione zero.
        for (const lato of [0, 1]) {
            for (let giro = 0; giro < 2; giro++) {
                for (let i = 0; i < n; i++) {
                    const pre = ((i - 1 + n) % n) * 2 + lato;
                    const qui = i * 2 + lato;
                    if (arretra[pre] - passo * PENDENZA_MAX > arretra[qui]) {
                        arretra[qui] = arretra[pre] - passo * PENDENZA_MAX;
                    }
                }
                for (let i = n - 1; i >= 0; i--) {
                    const post = ((i + 1) % n) * 2 + lato;
                    const qui = i * 2 + lato;
                    if (arretra[post] - passo * PENDENZA_MAX > arretra[qui]) {
                        arretra[qui] = arretra[post] - passo * PENDENZA_MAX;
                    }
                }
            }
        }
        return arretra;
    }

    // Il profilo della città, campione per campione e lato per lato.
    //
    // ⚠️ DETERMINISTICO E SENZA STATO: il seme viene dalla GEOMETRIA (le
    // coordinate del campione in cui il palazzo comincia), non da Math.random né
    // da un contatore. La stessa pista deve dare la stessa città ad ogni
    // caricamento — se cambiasse, il circuito avrebbe una faccia diversa ad ogni
    // partita — e due piste diverse città diverse. È lo stesso patto già in uso
    // per la scenografia.
    function profilo(trackPts, barrierProfile, opzioni) {
        const n = trackPts.length;
        const distanza = new Float64Array(n * 2);
        const altezza = new Float64Array(n * 2);
        const colore = new Array(n * 2);
        if (!n) return { distanza, altezza, colore };

        const passo = TrackGeometry.lapLength(trackPts) / n;
        const perPalazzo = Math.max(2, Math.round(PALAZZO_LUNGHEZZA / passo));
        const palette = tinte();
        const arretra = spazioPerIlPaddock(trackPts, barrierProfile, opzioni || {}, passo);

        for (const side of [1, -1]) {
            for (let i = 0; i < n; i++) {
                const k = i * 2 + (side > 0 ? 0 : 1);
                // La facciata si posa sul muro VERO di quel punto: dove la via
                // di fuga allarga, la città arretra con lei invece di tagliarla.
                // E dove passa il paddock arretra ancora: là fuori, prima dei
                // palazzi, ci sono la corsia box e i garage.
                distanza[k] = Math.max(
                    TrackGravel.barrierAt(barrierProfile, i, side) + MARCIAPIEDE, arretra[k]);

                // Il palazzo a cui questo campione appartiene: un blocco di
                // campioni consecutivi, così l'altezza resta ferma e poi salta.
                const inizio = Math.floor(i / perPalazzo) * perPalazzo;
                const q = trackPts[inizio % n];
                // Il lato entra nel seme, o i due bordi sarebbero uno lo
                // specchio dell'altro per tutto il giro.
                const seme = TrackScenery.hashString(
                    `${q.x.toFixed(1)}:${q.z.toFixed(1)}:${side > 0 ? 'd' : 's'}`);
                const rng = TrackScenery.mulberry32(seme);
                altezza[k] = ALTEZZA_MIN + rng() * (ALTEZZA_MAX - ALTEZZA_MIN);
                colore[k] = palette[Math.floor(rng() * palette.length) % palette.length];
            }
        }
        return { distanza, altezza, colore };
    }

    return { profilo, MARCIAPIEDE, ALTEZZA_MIN, ALTEZZA_MAX, PALAZZO_LUNGHEZZA, PADDOCK, PENDENZA_MAX, LUSSO_TRAGUARDO };
});
