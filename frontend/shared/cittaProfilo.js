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
                                 require('./toonPalette.js'), require('./semeStabile.js'));
    } else {
        root.CittaProfilo = factory(root.TrackGravel, root.TrackGeometry, root.ToonPalette,
                                    root.SemeStabile);
    }
})(typeof self !== 'undefined' ? self : this, function (TrackGravel, TrackGeometry, ToonPalette,
                                                        SemeStabile) {

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
    // 24 e non 20.6, perche' quella e' la distanza RADIALE del punto piu'
    // sporgente: in curva una tribuna lunga diciannove unita' e una colonna di
    // facciata sono anche ruotate l'una rispetto all'altra, e i loro spigoli si
    // incrociano pur avendo i centri alla distanza giusta. Le tre unita' e mezza
    // di scarto sono il prezzo di quella rotazione, misurato su citta-prova.
    //
    // ⚠️ E ci sta dentro anche LO SPESSORE DELLA FACCIATA. Il numero misura la
    // distanza fra il muro e il NASTRO, ma i moduli si posano sul nastro e
    // crescono verso la pista: tre unità di lastra, tende da sole e balconi.
    // Contando solo le 22 delle tribune, la prima fila di moduli arrivava
    // addosso alla tribuna — vista come compenetrazione di 2.90 su citta-prova.
    //
    // Abbassarlo si puo', ma non da solo: prima devono restare fuori le tribune.
    const SPESSORE_FACCIATA = 3;
    const MARCIAPIEDE = 24 + SPESSORE_FACCIATA;

    // ⚠️ L'ALTEZZA DI UN PALAZZO NON È LIBERA: È UNA PILA DI MODULI. Dalla spec
    // del 2026-08-27 la facciata è fatta di pezzi modellati — base, N piani
    // tipo, coronamento — e un palazzo alto 31.7 non esiste: esiste quello da
    // sette piani. Le tre misure sono le stesse di
    // `backend/tools/circuitAssets/cittaFacciate.py`, e vanno cambiate insieme:
    // se divergono, il coronamento galleggia o il nastro sbuca sopra il tetto.
    const H_BASE = 4.5;
    const H_PIANO = 3.5;
    const H_CORONAMENTO = 1.2;
    // Un palazzo più basso della carreggiata non chiude niente; oltre gli 11
    // piani si vede solo muro anche dall'abitacolo, e ogni unità in più è
    // schermo riempito — che su questo gioco è il costo che conta davvero.
    const PIANI_MIN = 3;
    const PIANI_MAX = 11;
    const altezzaDi = (piani) => H_BASE + piani * H_PIANO + H_CORONAMENTO;
    const ALTEZZA_MIN = altezzaDi(PIANI_MIN);
    const ALTEZZA_MAX = altezzaDi(PIANI_MAX);

    // Quanto è lungo un palazzo, in unità di pista. Sotto le 25 la fila si legge
    // come una scalinata, sopra le 60 come un capannone unico.
    const PALAZZO_LUNGHEZZA = 38;

    // ⚠️ Quanto è larga una colonna di facciata. È la stessa misura scritta in
    // `cittaFacciate.py` (W = 9.0): i moduli sono modellati su questa
    // larghezza, e posarli a un passo diverso li sovrapporrebbe o lascerebbe
    // una fessura fra l'uno e l'altro.
    const MODULO_LARGO = 9;

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
    //
    // ⚠️ La prima cifra è RICOPIATA da `trackScenery.js` invece che importata,
    // e non per pigrizia: da quando le facciate sono asset, è la scenografia a
    // dover nominare la città — deve posarne le colonne nel layout — e
    // importarla di rimando chiuderebbe un anello di require, che in Node
    // lascia mezzo modulo vuoto. A verificare che le due copie non divergano
    // pensa un test, non la buona volontà.
    const PADDOCK_OFFSET = 19.4;
    const PADDOCK_RETRO = 7.4;
    const PADDOCK = PADDOCK_OFFSET + PADDOCK_RETRO;

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
        // Chi è il palazzo di questo campione: quale famiglia-tinta, quanti
        // piani, quale variante del piano tipo, e che numero ha il palazzo.
        const tinta = new Int32Array(n * 2);
        const piani = new Int32Array(n * 2);
        const variante = new Int32Array(n * 2);
        const inizio = new Int32Array(n * 2);
        // Dove va posata ogni colonna di facciata. Le calcola QUI e non chi
        // posa i moduli, perché sono le stesse misure che decidono dove il
        // nastro cambia altezza: due conti separati vorrebbero dire un
        // coronamento che finisce a metà di uno scalino.
        const colonne = [];
        const vuoto = { distanza, altezza, colore, tinta, piani, variante, inizio, colonne };
        if (!n) return vuoto;

        const passoCampione = TrackGeometry.lapLength(trackPts) / n;
        const palette = tinte();
        const arretra = spazioPerIlPaddock(trackPts, barrierProfile, opzioni || {}, passoCampione);

        for (const side of [1, -1]) {
            const lato = side > 0 ? 0 : 1;
            // 1. Dove sta la facciata, campione per campione.
            const bordo = new Array(n);
            for (let i = 0; i < n; i++) {
                const k = i * 2 + lato;
                // La facciata si posa sul muro VERO di quel punto: dove la via
                // di fuga allarga, la città arretra con lei invece di tagliarla.
                // E dove passa il paddock arretra ancora: là fuori, prima dei
                // palazzi, ci sono la corsia box e i garage.
                distanza[k] = Math.max(
                    TrackGravel.barrierAt(barrierProfile, i, side) + MARCIAPIEDE, arretra[k]);
                const p = trackPts[i];
                const nrm = TrackGeometry.normalAt(trackPts, i, true);
                bordo[i] = {
                    x: p.x + nrm.nx * distanza[k] * side,
                    z: p.z + nrm.nz * distanza[k] * side,
                    y: p.y || 0,
                    // Verso cui guarda la facciata: la pista, cioè il contrario
                    // della normale dalla sua parte.
                    rotY: Math.atan2(-nrm.nx * side, -nrm.nz * side),
                };
            }

            // 2. Quanto è lungo il giro DELLA FACCIATA — non dell'asse: in curva
            // la facciata esterna è più lunga, e misurare sull'asse darebbe una
            // colonna in meno proprio dove se ne vedono di più.
            const percorso = new Float64Array(n + 1);
            for (let i = 1; i <= n; i++) {
                const a = bordo[i - 1], b = bordo[i % n];
                percorso[i] = percorso[i - 1] + Math.hypot(b.x - a.x, b.z - a.z);
            }
            const giro = percorso[n];

            // 3. Le colonne: un numero INTERO su tutto il giro, o l'ultima
            // resterebbe mezza tagliata nel punto di chiusura. Il passo vero si
            // stira di poco attorno a MODULO_LARGO, e il corpo dei moduli è tre
            // decimi più stretto apposta per assorbirlo.
            const quante = Math.max(1, Math.round(giro / MODULO_LARGO));
            const passo = giro / quante;

            // 4. I palazzi si contano in COLONNE, non in campioni. È ciò che
            // fa combaciare lo scalino del nastro con la giunzione fra due
            // facciate: se il confine cadesse in mezzo a una colonna, dietro
            // mezza facciata il nastro avrebbe l'altezza del palazzo sbagliato.
            const perPalazzo = Math.max(1, Math.round(PALAZZO_LUNGHEZZA / MODULO_LARGO));
            const quantiPalazzi = Math.max(1, Math.ceil(quante / perPalazzo));

            // 5. Che palazzo è, palazzo per palazzo. Il seme viene dalla
            // GEOMETRIA — il punto in cui il palazzo comincia — non da un
            // contatore: la stessa pista deve dare la stessa città a ogni
            // caricamento, e due piste diverse città diverse.
            const scelta = [];
            for (let b = 0; b < quantiPalazzi; b++) {
                const q = puntoA(bordo, percorso, n, b * perPalazzo * passo);
                const seme = SemeStabile.hashString(
                    `${q.x.toFixed(1)}:${q.z.toFixed(1)}:${side > 0 ? 'd' : 's'}`);
                const rng = SemeStabile.mulberry32(seme);
                const quantiPiani = PIANI_MIN + Math.floor(rng() * (PIANI_MAX - PIANI_MIN + 1));
                const quale = Math.floor(rng() * palette.length) % palette.length;
                scelta.push({ piani: quantiPiani, tinta: quale, variante: rng() < 0.5 ? 0 : 1 });
            }

            // 6. Ogni campione eredita il palazzo della colonna in cui cade.
            for (let i = 0; i < n; i++) {
                const k = i * 2 + lato;
                const colonna = Math.min(quante - 1, Math.floor(percorso[i] / passo));
                const b = Math.min(quantiPalazzi - 1, Math.floor(colonna / perPalazzo));
                const s = scelta[b];
                altezza[k] = altezzaDi(s.piani);
                piani[k] = s.piani;
                tinta[k] = s.tinta;
                colore[k] = palette[s.tinta].colore;
                variante[k] = s.variante;
                inizio[k] = b;
            }

            // 7. E le colonne, al centro del loro tratto.
            for (let c = 0; c < quante; c++) {
                const dove = puntoA(bordo, percorso, n, (c + 0.5) * passo);
                const b = Math.min(quantiPalazzi - 1, Math.floor(c / perPalazzo));
                colonne.push({
                    side, indice: c, palazzo: b,
                    x: dove.x, y: dove.y, z: dove.z, rotY: dove.rotY,
                    tinta: scelta[b].tinta, piani: scelta[b].piani, variante: scelta[b].variante,
                });
            }
        }
        return vuoto;
    }

    // ⚠️ IL PROFILO DI UNA PISTA SI CHIEDE DA QUI, non componendo le opzioni a
    // mano. Lo calcolano due sistemi diversi — la mesh del nastro (f1Scena) e le
    // colonne di facciata (trackScenery) — e devono ottenere lo STESSO profilo:
    // se uno dei due dimenticasse il traguardo o la corsia box, il nastro
    // cambierebbe altezza dove le facciate non lo fanno, e si vedrebbe uno
    // scalino di muro nudo sopra un palazzo intero.
    function perPista(trackData, trackPts, barrierProfile, pitLanePts) {
        if (!trackData || trackData.ambientazione !== 'citta') return null;
        const sf = trackData.startFinish
            ? TrackGeometry.nearestPoint(trackPts, trackData.startFinish.x, trackData.startFinish.z).index
            : 0;
        return profilo(trackPts, barrierProfile, {
            pitLanePts,
            pitRoadHalf: trackData.pit ? trackData.pit.roadHalfWidth : 0,
            startFinishIndex: sf,
        });
    }

    // Il punto della facciata a distanza `s` dall'inizio del giro.
    function puntoA(bordo, percorso, n, s) {
        const giro = percorso[n];
        let d = s % giro;
        if (d < 0) d += giro;
        // Ricerca binaria: il giro ha mille campioni e le colonne sono
        // centinaia, e una scansione lineare per ciascuna sarebbe quadratica.
        let lo = 0, hi = n;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (percorso[mid] <= d) lo = mid; else hi = mid;
        }
        const a = bordo[lo], b = bordo[(lo + 1) % n];
        const tratto = percorso[lo + 1] - percorso[lo];
        const t = tratto > 1e-9 ? (d - percorso[lo]) / tratto : 0;
        return {
            x: a.x + (b.x - a.x) * t,
            z: a.z + (b.z - a.z) * t,
            y: a.y + (b.y - a.y) * t,
            // ⚠️ L'orientamento NON si interpola fra due angoli: a cavallo di
            // ±π la media fra 179° e -179° è zero, cioè la facciata girata al
            // contrario. Si prende quello del campione più vicino.
            rotY: (t < 0.5 ? a : b).rotY,
        };
    }

    return {
        profilo, perPista, MARCIAPIEDE, SPESSORE_FACCIATA, ALTEZZA_MIN, ALTEZZA_MAX, PALAZZO_LUNGHEZZA,
        PADDOCK, PADDOCK_OFFSET, PENDENZA_MAX, LUSSO_TRAGUARDO,
        H_BASE, H_PIANO, H_CORONAMENTO, PIANI_MIN, PIANI_MAX, MODULO_LARGO,
    };
});
