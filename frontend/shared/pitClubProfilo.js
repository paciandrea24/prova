// frontend/shared/pitClubProfilo.js
//
// DOVE STA IL PALAZZO DEI BOX, e nient'altro (spec 2026-09-03).
//
// È l'unico modulo che sa dove il palazzo comincia, dove finisce e com'è fatta
// ciascuna delle sue fette. Chi lo posa (trackScenery.js) e chi lo controlla (i
// test) chiedono a lui: due conti separati farebbero finire una testa in mezzo
// alla facciata, ed è esattamente l'errore già visto sulle facciate della città
// — il 26% delle colonne perso nei giunti perché il confine era deciso in due
// unità diverse.
//
// Modulo PURO: niente Three.js, niente DOM.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./trackGeometry.js'));
    else root.PitClubProfilo = factory(root.TrackGeometry);
})(typeof self !== 'undefined' ? self : this, function (TrackGeometry) {

    // ⚠️ IL PASSO NON SI ADATTA, SI ADATTA LA LUNGHEZZA. Mezzo passo di box:
    // così il confine di ogni box cade su un confine di fetta, e nessun box si
    // trova mezzo dentro e mezzo fuori dal proprio vano. Ricavarlo dividendo la
    // lunghezza del tratto darebbe 7.4 su una pista e 7.6 su un'altra, mentre i
    // box stanno a 15 fissi ovunque.
    const PASSO = TrackGeometry.PIT_BOX_SPACING / 2;

    // ⚠️ IL PALAZZO E' LUNGO SEMPRE UGUALE, qualunque sia il numero di piloti:
    // copre i box di una griglia piena. `gridSize` arriva dalla lobby e cambia
    // da una partita all'altra; un palazzo che si accorcia coi piloti
    // cambierebbe pista fra una gara e l'altra, e la scenografia cotta (mappe
    // immutabili) non varrebbe più per entrambe.
    //
    // Quello che cambia col numero di piloti è cosa c'è SOTTO, non quanto è
    // lungo: vedi `tipoDi`.
    const GRID_PIENA = 20;

    // Due fette di margine per capo, che sono anche le due teste.
    const MARGINE_FETTE = 2;

    // Dal bordo della corsia al CENTRO della fetta. Nasce dalla misura dei box
    // dei piloti — PIT_BOX_FRONT_HALF_DEPTH 11 + PIT_BOX_CLEARANCE 12 in
    // pitBoxLoader.js, cioè 23 — più un'unità e mezza di arretramento.
    //
    // ⚠️ QUELL'UNITA' E MEZZA NON E' ARBITRARIA. La balconata sporge di 1.6
    // oltre il fronte del corpo, quindi a 23 il footprint della fetta arrivava
    // a 11 dal bordo corsia ed entrava nel GREMBIULE di manovra dei box —
    // quello spazio davanti al garage dove l'auto si ferma e sterza per
    // rientrare, protetto da un'invariante dal 2026-08-10. In quota non si
    // toccano (la balconata sta a 11.7 e un'auto è alta 1), ma la scenografia
    // ragiona in pianta, e un'eccezione «tanto è in alto» sarebbe una porta
    // aperta per il prossimo oggetto che davvero ostruisce.
    //
    // Arretrando, la balconata resta a filo del fronte dei box invece di
    // sporgergli davanti: il palazzo è ordinato lo stesso.
    const OFFSET_FRONTE = 24.5;

    // Quanto deve restare fra il corpo del palazzo e il bordo della corsia.
    const MEZZA_PROFONDITA = 11;
    const FRANCO_CORSIA = 2;
    const SCOSTAMENTO_MAX = 40;

    // Una torre ogni TORRE_PASSO fette, mai a ridosso di una testa.
    const TORRE_PASSO = 9;

    // Entro quanto una fetta e un box si toccano: mezzo box piu' mezza fetta.
    //
    // ⚠️ NON MEZZO PASSO. Con 7.5 restava scoperta la fascia fra 7.5 e 8.05: un
    // box e' largo 14.1 e il suo ingombro protetto arriva a 8.05 per lato,
    // quindi una fetta col piano terra PIENO poteva cadere dentro un garage del
    // giocatore senza essere marcata — misurato su monte-rosso, una pitClubBay
    // a (32.1, 60.1) dentro l'ingombro reale di un box.
    const SOGLIA_BOX = TrackGeometry.PIT_BOX_SPACING / 2 + PASSO / 2;

    // Le ascisse dei box rispetto a boxIndex, per un dato numero di piloti.
    //
    // ⚠️ Stessa formula di TrackGeometry.pitBoxAnchors — Math.floor e non
    // (count - 1) / 2 — perché le due devono cadere sulle stesse posizioni. Una
    // formula ricopiata a metà mette i box mezzo passo più in là, e il difetto
    // non si vede finché non si guarda in pista: un garage colorato dentro il
    // muro di una fetta col piano terra pieno.
    function offsetDeiBox(quanti) {
        const mid = Math.floor((quanti - 1) / 2);
        const out = [];
        for (let i = 0; i < quanti; i++) out.push((i - mid) * TrackGeometry.PIT_BOX_SPACING);
        return out;
    }

    // Quanta corsia c'è prima e dopo boxIndex. Serve a non far uscire il palazzo
    // dalla corsia: `pitSlotAt` satura ai capi, e le fette oltre il capo si
    // accatasterebbero tutte sullo stesso punto.
    function corsiaDisponibile(pitPath, boxIndex) {
        let prima = 0, dopo = 0;
        for (let i = 1; i <= boxIndex && i < pitPath.length; i++) {
            prima += Math.hypot(pitPath[i].x - pitPath[i - 1].x, pitPath[i].z - pitPath[i - 1].z);
        }
        for (let i = boxIndex + 1; i < pitPath.length; i++) {
            dopo += Math.hypot(pitPath[i].x - pitPath[i - 1].x, pitPath[i].z - pitPath[i - 1].z);
        }
        return { prima, dopo };
    }

    // Il punto sul nastro del palazzo che corrisponde a un'ascissa della corsia,
    // e il punto di corsia che quella fetta deve guardare.
    function puntoFronte(pitPath, boxIndex, offset, trackPts, pitRoadHalf, scostamento) {
        const s = TrackGeometry.pitSlotAt(pitPath, boxIndex, offset, trackPts, pitRoadHalf);
        const nx = -s.tz, nz = s.tx;
        // Da che parte sta il paddock: quella che si ALLONTANA dalla pista.
        const distPlus = TrackGeometry.nearestPoint(trackPts, s.x + nx, s.z + nz).dist;
        const distMinus = TrackGeometry.nearestPoint(trackPts, s.x - nx, s.z - nz).dist;
        const lato = distPlus >= distMinus ? 1 : -1;
        const off = pitRoadHalf + OFFSET_FRONTE + scostamento;
        const p = pitPath[Math.min(s.fromIdx, pitPath.length - 1)];
        return {
            x: s.x + nx * off * lato,
            z: s.z + nz * off * lato,
            y: p.y || 0,
            verso: { x: s.x, z: s.z },
        };
    }

    // Le ascisse delle fette: multipli interi del passo, in fase con i box
    // (offset 0 = boxIndex), estese fino a coprire la griglia piena più il
    // margine, e comunque dentro la corsia disponibile.
    function ascisse(pitPath, boxIndex) {
        const box = offsetDeiBox(GRID_PIENA);
        const { prima, dopo } = corsiaDisponibile(pitPath, boxIndex);
        const estremoIndietro = Math.ceil(Math.abs(Math.min.apply(null, box)) / PASSO) + MARGINE_FETTE;
        const estremoAvanti = Math.ceil(Math.max.apply(null, box) / PASSO) + MARGINE_FETTE;
        // Senza uscire dalla corsia: oltre il capo pitSlotAt satura e le fette
        // si accatastano tutte nello stesso punto.
        const limiteIndietro = Math.floor(Math.max(0, prima - PASSO) / PASSO);
        const limiteAvanti = Math.floor(Math.max(0, dopo - PASSO) / PASSO);
        const k0 = -Math.min(estremoIndietro, limiteIndietro);
        const k1 = Math.min(estremoAvanti, limiteAvanti);
        const out = [];
        for (let k = k0; k <= k1; k++) out.push(k * PASSO);
        return out;
    }

    // Quanto il passo REALE fra due fette può scostarsi dal passo nominale
    // prima che quel tratto vada buttato. Il nastro del palazzo corre 23 unità
    // più in fuori della corsia: dove la corsia gira stretta, il nastro interno
    // si accorcia fino a ripiegarsi, e due fette a 7.5 di ascissa finiscono a
    // 0.2 l'una dall'altra — cioè una dentro l'altra.
    const PASSO_MIN_FRAZIONE = 0.6;
    const PASSO_MAX_FRAZIONE = 1.7;

    // Quanto possono divergere due fette consecutive prima che quel tratto vada
    // buttato. Non basta guardare il passo: un arco stretto lo mantiene e gira
    // lo stesso: misurato, sul nastro di monte-rosso il raggio locale scende a
    // 14 unità, cioè 31 GRADI fra una fetta e la vicina e un giunto aperto di
    // due unità. Quello non è più un edificio continuo, è una fisarmonica.
    //
    // 10 gradi corrispondono a un giunto aperto di 0.64 sui 7.3 di larghezza,
    // che la lesena davanti copre in buona parte. Sopra, il palazzo finisce.
    //
    // ⚠️ NON PIU' STRETTO DI COSI'. A 7 gradi il palazzo di `loop-prova` si
    // spezzava in due tronconi per UN giunto da 7.4, e restava lungo cinque
    // fette. Le pieghe vere che questa soglia deve fermare sono di ben altro
    // ordine: 24 gradi su melbourne, 108 e 163 all'imbocco di `prova`.
    const ANGOLO_MAX = 10 * Math.PI / 180;

    // Il palazzo si ferma dove il nastro collassa.
    //
    // ⚠️ MISURATO SU `prova`: all'imbocco la corsia gira di 45 gradi in 15
    // unità, e le prime tre fette avevano passo reale 0.20, 9.28 e 0.13 invece
    // di 7.5 — tre volumi da 18 metri uno dentro l'altro proprio dove il
    // giocatore entra ai box. È lo stesso motivo per cui gli edifici decorativi
    // non nascono all'imbocco (PIT_BUILDING_TRACK_CLEARANCE): là dentro non ci
    // sta niente di rigido, e il palazzo è la cosa più rigida che c'è.
    //
    // Si taglia dai CAPI verso il centro: un tratto malato in mezzo spezzerebbe
    // il palazzo in due, e allora è giusto che sia un test a dirlo invece che
    // questo codice a nasconderlo.
    // `ancore` sono gli indici di fetta sotto cui cade un box, sempre calcolati
    // sulla GRIGLIA PIENA: la scelta del tratto non deve dipendere da quanti
    // piloti giocano, o il palazzo cambierebbe lunghezza da una gara all'altra.
    function tagliaDoveCollassa(offsets, punti, ancore) {
        const minimo = PASSO * PASSO_MIN_FRAZIONE;
        const massimo = PASSO * PASSO_MAX_FRAZIONE;

        // Il passo reale fra la fetta k e la k+1.
        function passo(k) {
            return Math.hypot(punti[k + 1].x - punti[k].x, punti[k + 1].z - punti[k].z);
        }
        // Di quanto gira il nastro fra la fetta k-1 e la k+1.
        function angolo(k) {
            const ax = punti[k].x - punti[k - 1].x, az = punti[k].z - punti[k - 1].z;
            const bx = punti[k + 1].x - punti[k].x, bz = punti[k + 1].z - punti[k].z;
            const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
            if (la < 1e-9 || lb < 1e-9) return Math.PI;
            const cos = Math.max(-1, Math.min(1, (ax * bx + az * bz) / (la * lb)));
            return Math.acos(cos);
        }
        function sano(k, verso) {
            const p = verso > 0 ? passo(k) : passo(k - 1);
            if (p < minimo || p > massimo) return false;
            const dentro = k + verso;
            if (dentro > 0 && dentro < punti.length - 1 && angolo(dentro) > ANGOLO_MAX) return false;
            return true;
        }

        // ⚠️ NON BASTA TAGLIARE DAI CAPI. Su `prova` il tratto in cui il nastro
        // si ripiega e' la QUARTA fetta di ventitre: rosicchiando dagli estremi
        // non ci si arriva mai, e restava un palazzo con una piega da 31 gradi
        // in mezzo alla facciata. Si cerca invece il tratto CONTIGUO sano piu'
        // lungo, e fra quelli si preferisce quello che contiene boxIndex —
        // l'offset 0 — perche' e' li' che stanno i box dei giocatori: un
        // palazzo perfetto dall'altra parte della corsia non serve a niente.
        const rotto = [];
        for (let k = 0; k < punti.length - 1; k++) {
            let male = passo(k) < minimo || passo(k) > massimo;
            if (!male && k > 0 && angolo(k) > ANGOLO_MAX) male = true;
            if (!male && k + 1 < punti.length - 1 && angolo(k + 1) > ANGOLO_MAX) male = true;
            rotto.push(male);
        }

        let migliore = { da: 0, a: 0, punteggio: -1 };
        let inizio = 0;
        for (let k = 0; k <= rotto.length; k++) {
            if (k === rotto.length || rotto[k]) {
                const fine = k;              // ultima fetta del tratto
                if (fine > inizio) {
                    // ⚠️ QUANTI box copre, non SE ne copre almeno uno. Con un
                    // bonus secco «contiene l'offset 0» su melbourne vinceva un
                    // tratto di TRE fette contro uno di sedici, perche' i primi
                    // box saturano all'imbocco: il palazzo spariva (meno di
                    // quattro fette) e la pista restava senza.
                    let coperti = 0;
                    for (let b = 0; b < ancore.length; b++) {
                        if (ancore[b] >= inizio && ancore[b] <= fine) coperti++;
                    }
                    const punteggio = coperti * 100 + (fine - inizio);
                    if (punteggio > migliore.punteggio) {
                        migliore = { da: inizio, a: fine, punteggio: punteggio };
                    }
                }
                inizio = k + 1;
            }
        }
        return { da: migliore.da, a: migliore.a };
    }

    // Quanto va scostato il palazzo perché nessuna fetta entri nella corsia.
    //
    // ⚠️ UN VALORE SOLO PER TUTTE, teste comprese. Gli edifici decorativi si
    // scostano ognuno per conto proprio (PIT_BUILDING_LANE_PUSH_MAX): in una
    // fila di volumi staccati non si vede, in un muro continuo aprirebbe un
    // gradino in mezzo alla facciata. E nessuna rampa di smorzamento ai capi:
    // fra la penultima e l'ultima fetta aprirebbe mezzo scostamento, cioè
    // proprio il gradino che si vuole evitare.
    function scostamentoComune(pitPath, boxIndex, offsets, trackPts, pitRoadHalf) {
        const serve = pitRoadHalf + MEZZA_PROFONDITA + FRANCO_CORSIA;
        let massimo = 0;
        for (let i = 0; i < offsets.length; i++) {
            for (let extra = 0; extra <= SCOSTAMENTO_MAX; extra += 1) {
                const q = puntoFronte(pitPath, boxIndex, offsets[i], trackPts, pitRoadHalf, extra);
                if (TrackGeometry.nearestPoint(pitPath, q.x, q.z).dist >= serve) {
                    if (extra > massimo) massimo = extra;
                    break;
                }
            }
        }
        return massimo;
    }

    // Quali fette hanno un box del giocatore sotto.
    //
    // ⚠️ SI CHIEDE ALLE ANCORE VERE, non agli offset teorici dei box. I due
    // numeri coincidono solo finché la corsia ha spazio a sufficienza: dove non
    // ce l'ha — su melbourne il boxIndex sta a inizio corsia — `pitSlotAt`
    // satura, i box si addensano al capo e un offset calcolato a tavolino
    // indica un posto dove il box non è. Si prende la fetta più VICINA a
    // ciascuna ancora, che è una domanda senza parametri da tarare.
    //
    // ⚠️ E le ancore sono quelle dei piloti che ci sono DAVVERO, non delle
    // venti posizioni della griglia piena: con sei piloti quattordici vani
    // resterebbero buchi veri e il palazzo starebbe su palafitte. Dove il box
    // non c'è va una `Bay`, con la serranda chiusa — il palazzo resta lungo
    // uguale, cambia solo cosa c'è sotto.
    function indiciConBoxSotto(punti, pitPath, boxIndex, trackPts, pitRoadHalf, quanti) {
        const ancore = TrackGeometry.pitBoxAnchors(pitPath, boxIndex, quanti,
                                                   trackPts, pitRoadHalf);
        const set = {};
        for (let i = 0; i < ancore.length; i++) {
            for (let k = 0; k < punti.length; k++) {
                // ⚠️ SI CONFRONTA SULLA CORSIA, non fra i centri. L'ancora di un
                // box e' un punto della CORSIA; il centro di una fetta sta 23
                // unita' piu' in fuori. Confrontarli direttamente misura quel 23
                // piu' lo scostamento, e la risposta non dipende quasi da chi
                // sta sopra chi: `punti[k].verso` e' il punto di corsia di
                // quella fetta, ed e' con quello che il box va confrontato.
                //
                // ⚠️ E SERVE UNA DISTANZA, non un «piu' vicino». Prendendo
                // sempre la fetta piu' vicina, un box lontano cento unita' dal
                // palazzo veniva marcato lo stesso — su `prova` il palazzo sta
                // da offset 67.5 a 165 e i box da -30 a 45, e il test lo
                // dichiarava coperto. Mezzo passo di box e' la misura giusta:
                // oltre, quel box il palazzo non ce l'ha sopra.
                const d = Math.hypot(punti[k].verso.x - ancore[i].x,
                                     punti[k].verso.z - ancore[i].z);
                if (d <= SOGLIA_BOX) set[k] = true;
            }
        }
        return set;
    }

    // Dove mettere le due teste: la prima fetta di ciascun capo che non abbia un
    // box sotto.
    //
    // ⚠️ LO SPAN VINCE SULLA TESTA. Sembrava naturale dire «la testa è la fetta
    // 0 e l'ultima», e su melbourne ci metteva un fianco chiuso sopra il box del
    // giocatore. Un capo senza testa è brutto; una testa sopra un box è un
    // garage murato, che è peggio.
    function indiciTesta(n, conBox) {
        const out = {};
        for (let k = 0; k < n; k++) { if (!conBox[k]) { out[k] = true; break; } }
        for (let k = n - 1; k >= 0; k--) { if (!conBox[k] && !out[k]) { out[k] = true; break; } }
        return out;
    }

    function tipoDi(k, ultimo, conBox, teste) {
        if (conBox[k]) return 'pitClubSpan';
        if (teste[k]) return 'pitClubHead';
        if (k % TORRE_PASSO === 0 && k > 1 && k < ultimo - 1) return 'pitClubTower';
        return 'pitClubBay';
    }

    // Le fette del palazzo, in ordine lungo la corsia.
    function fette(pitPath, boxIndex, trackPts, pitRoadHalf, gridSize) {
        if (!pitPath || pitPath.length < 2) return [];
        let offsets = ascisse(pitPath, boxIndex);
        if (offsets.length < 4) return [];

        // Prima il taglio, poi lo scostamento: le fette accatastate all'imbocco
        // chiederebbero uno scostamento enorme per uscire dalla corsia, e quello
        // vale per TUTTE — un tratto da buttare porterebbe indietro il palazzo
        // intero di dieci unità.
        const grezzi = offsets.map(function (o) {
            return puntoFronte(pitPath, boxIndex, o, trackPts, pitRoadHalf, 0);
        });
        const ancoreSuFette = indiciConBoxSotto(grezzi, pitPath, boxIndex, trackPts,
                                                pitRoadHalf, GRID_PIENA);
        const buono = tagliaDoveCollassa(offsets, grezzi, Object.keys(ancoreSuFette).map(Number));
        offsets = offsets.slice(buono.da, buono.a + 1);
        if (offsets.length < 4) return [];

        const scostamento = scostamentoComune(pitPath, boxIndex, offsets, trackPts, pitRoadHalf);
        const quantiBox = Math.max(1, Math.min(GRID_PIENA, gridSize || GRID_PIENA));
        const punti = offsets.map(function (o) {
            return puntoFronte(pitPath, boxIndex, o, trackPts, pitRoadHalf, scostamento);
        });
        const conBox = indiciConBoxSotto(punti, pitPath, boxIndex, trackPts, pitRoadHalf, quantiBox);
        const teste = indiciTesta(punti.length, conBox);

        // Orientamento perpendicolare al NASTRO, non diretto al punto di corsia:
        // le due direzioni coincidono in rettilineo e divergono in curva, perché
        // il nastro corre 23 unità più in fuori e ha quindi un raggio diverso.
        // Puntando al punto di corsia le fette si aprirebbero a ventaglio, e fra
        // l'una e l'altra resterebbe uno spicchio di vuoto — lo stesso difetto
        // già visto e corretto sugli edifici decorativi.
        function orientamento(k) {
            const a = punti[Math.max(0, k - 1)];
            const b = punti[Math.min(punti.length - 1, k + 1)];
            let tx = b.x - a.x, tz = b.z - a.z;
            const len = Math.hypot(tx, tz);
            const q = punti[k];
            if (len < 1e-9) return Math.atan2(q.verso.x - q.x, q.verso.z - q.z);
            tx /= len; tz /= len;
            let fx = -tz, fz = tx;
            if ((q.verso.x - q.x) * fx + (q.verso.z - q.z) * fz < 0) { fx = -fx; fz = -fz; }
            return Math.atan2(fx, fz);
        }

        // ⚠️ QUALE TESTA GIRARE NON E' «L'ULTIMA». Il fianco chiuso sta su +X
        // del modello, e quale delle due estremità quel +X guardi dipende dal
        // verso in cui la corsia corre su questa pista: su una fila girata
        // dall'altra parte, «giro l'ultima» chiude il capo sbagliato e lascia
        // l'altro con la sezione a vista. E' successo sul primo render
        // dell'anteprima, e l'ha visto l'utente.
        //
        // La regola si misura invece di indovinarla: il fianco deve guardare
        // DALLA PARTE OPPOSTA al vicino. In Three una rotazione rotY attorno a Y
        // manda +X locale su (cos rotY, -sin rotY).
        function fiancoVersoIlVicino(k, rotY) {
            const vicino = punti[k === 0 ? 1 : k - 1];
            const vx = vicino.x - punti[k].x, vz = vicino.z - punti[k].z;
            return Math.cos(rotY) * vx - Math.sin(rotY) * vz > 0;
        }

        const ultimo = offsets.length - 1;
        return offsets.map(function (offset, k) {
            const rotY = orientamento(k);
            return {
                offset: offset,
                tipo: tipoDi(k, ultimo, conBox, teste),
                x: punti[k].x,
                y: punti[k].y,
                z: punti[k].z,
                // Il punto di CORSIA di questa fetta. Serve a chiunque debba
                // confrontarla con qualcosa che vive sulla corsia — i box dei
                // piloti, per esempio: i loro centri stanno 23 unita' piu' in
                // dentro, e confrontarli coi centri delle fette misura quel 23
                // invece di dire chi sta sopra chi.
                corsia: { x: punti[k].verso.x, z: punti[k].verso.z },
                rotY: rotY + (teste[k] && fiancoVersoIlVicino(k, rotY) ? Math.PI : 0),
            };
        });
    }

    // Un'ascissa della corsia è già occupata dal palazzo? Serve a chi posa gli
    // edifici decorativi, che dentro il tratto non devono nascere affatto.
    // ⚠️ NESSUN MARGINE OLTRE GLI ESTREMI. Ne avevo messo uno di un passo per
    // stare larghi, e teneva vuota una fascia di 7.5 unita' a ciascun capo dove
    // un edificio ci stava benissimo: su new-monza il tratto di circuito senza
    // niente di fianco passava da 90 a 99 unita'. A dire se un edificio ci sta
    // pensa gia' il controllo di ingombro, che vede il palazzo perche' e' nato
    // prima di lui — non serve tenergli sgombra anche l'aria intorno.
    function dentroIlPalazzo(offsets, offset) {
        if (!offsets || !offsets.length) return false;
        return offset >= offsets[0] && offset <= offsets[offsets.length - 1];
    }

    return {
        PASSO: PASSO,
        GRID_PIENA: GRID_PIENA,
        MARGINE_FETTE: MARGINE_FETTE,
        OFFSET_FRONTE: OFFSET_FRONTE,
        TORRE_PASSO: TORRE_PASSO,
        fette: fette,
        ascisse: ascisse,
        dentroIlPalazzo: dentroIlPalazzo,
    };
});
