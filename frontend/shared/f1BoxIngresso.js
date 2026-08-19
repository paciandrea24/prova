// frontend/shared/f1BoxIngresso.js
//
// Come si entra nel proprio stallo ai box.
//
// COM'ERA. L'autopilota percorreva la corsia fino ad essere ESATTAMENTE
// all'altezza del proprio box, e da lì puntava dritto allo stallo: una svolta
// misurata in 88-91 gradi su ogni box di ogni pista, cioè l'auto che ruota
// quasi sul posto e trasla di lato. «Nella F1 vera non succede: si sterza prima
// e si arriva dritti dentro» (richiesta utente, 2026-08-19).
//
// COM'È. Una sola curva a S: mentre si avanza lungo la corsia ci si sposta
// lateralmente fino allo stallo, arrivandoci con l'auto già parallela alla
// corsia — che è come deve restare ferma. Nessuna rotazione sul posto, nessun
// balzo: la direzione dell'auto è semplicemente quella in cui si sta muovendo.
//
// IL VINCOLO CHE DECIDE LA FORMA. Non è l'eleganza della curva: è che gli altri
// stalli hanno dentro delle auto ferme. Lo stallo sta a 12-15 unità di lato
// (fino a 22.7 su monte-rosso) mentre i box distano solo 13-16 unità l'uno
// dall'altro lungo la corsia: lo spostamento di traverso è grande quanto il
// passo in avanti, e una diagonale unica passa addosso al vicino.
//
// Per questo la manovra è a DUE TEMPI, che poi è quella vera: prima ci si porta
// a metà strada, nella fascia libera fra la corsia e la fila degli stalli, poi
// — superata l'auto ferma nel box precedente — si entra. Fra i due tempi si
// viaggia dritti, esattamente come in una corsia box reale si sta nella
// "working lane" prima di girare nel proprio garage.
//
// QUANTO SI PUÒ MIGLIORARE, E PERCHÉ NON DI PIÙ. I parametri qui sotto non sono
// scelti a occhio: si sono provate tutte le combinazioni di lunghezze e di
// ripartizione su tutti i box di `prova` e `monte-rosso`, misurando la
// separazione fra ingombri ORIENTATI (mai fra i centri). Il risultato è che con
// questa geometria nessuna traiettoria scende sotto i ~54° di sterzata di
// picco, e quelle sotto i 61° hanno margini inferiori all'unità. Da 88-91° a
// 61° con arrivo dritto è tutto ciò che la geometria concede.
//
// Il parametro che crea il muro è PIT_STALL_CLEARANCE (trackGeometry.js), messo
// a 10 su richiesta esplicita dell'utente il 2026-08-07 per "spingere la
// schiera di box più indietro". Riavvicinare gli stalli alla corsia renderebbe
// possibile la manovra dolce vera, ma annullerebbe quella scelta: è una
// decisione sua, non una svista da correggere.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(
        typeof require === 'function' ? require('./trackGeometry.js') : null);
    else root.F1BoxIngresso = factory(root.TrackGeometry);
})(typeof self !== 'undefined' ? self : this, function (TrackGeometry) {

    // Primo tempo: ci si porta al bordo della fascia di sicurezza, in RACCORDO_A
    // unità. Questo tratto è tutto in spazio libero (fra la corsia e la fila
    // degli stalli non c'è niente), quindi allungarlo o accorciarlo non cambia
    // la sicurezza — misurato: 16, 20, 24 e 28 danno lo stesso identico margine.
    // Vale solo per la morbidezza.
    const RACCORDO_A = 20;

    // A che distanza dalla fila degli stalli si transita nel primo tempo. È il
    // numero che tiene lontani dalle auto ferme, ed è una DISTANZA, non una
    // percentuale dello spostamento: una frazione fissa vuol dire transitare a
    // 6 unità dagli stalli su un box e a 10 su un altro, cioè comportamenti
    // diversi in silenzio. Con la frazione, sul box più esterno di
    // `monte-rosso` (spostato di 22.7) restavano 0.23 unità di aria.
    const FASCIA_SICUREZZA = 6;

    // Secondo tempo: il resto dello spostamento. La lunghezza non è fissa —
    // dipende da QUANTO resta da spostarsi, che varia molto: su `monte-rosso` un
    // box sta a 21 unità di lato mentre i suoi vicini stanno a 14.4, e a
    // quello resta il doppio di strada da fare rispetto a un box di `prova`.
    // Con una lunghezza sola, o è ripida per lui (73° di sterzata, misurati) o è
    // troppo lunga per gli altri, e a 20 unità su `prova` si finisce addosso
    // all'auto ferma nel box precedente.
    const RACCORDO_B_MIN = 14;
    const RACCORDO_B_MAX = 18;
    const RACCORDO_B_PER_UNITA = 1.6;

    function lunghezzaSecondoTempo(residuo) {
        return Math.max(RACCORDO_B_MIN, Math.min(RACCORDO_B_MAX, Math.abs(residuo || 0) * RACCORDO_B_PER_UNITA));
    }

    // ── Il muro del gioco di reazione ───────────────────────────────────────
    //
    // Un pannello verticale, semi-trasparente, attraverso la corsia: si preme
    // nell'istante in cui il MUSO lo attraversa. È il modello del gioco
    // ufficiale, ed è stato scelto dall'utente dopo aver visto la prima
    // versione — che erano tre bande dipinte per terra.
    //
    // PERCHÉ IL MUSO E NON IL BARICENTRO. La prima versione giudicava sulla
    // posizione dell'auto, cioè sul suo centro, mentre chi gioca mira con la
    // punta: sono 3.58 unità di scarto — la semilunghezza — contro una fascia
    // perfetta di ±3, quindi si finiva sistematicamente in "buona" pur avendo
    // premuto sul punto giusto. Segnalato al playtest: «mi è sembrato che
    // stessi sulla porzione verde quando ho premuto spazio ma mi ha sempre dato
    // buona». Con un muro verticale il riferimento è inequivocabile: quello che
    // lo attraversa è il muso, e su quello si giudica.
    const SEMILUNGHEZZA_AUTO = 3.58;   // CollisionResolver.CAR_HALF_LENGTH

    // Dove sta il muro: quanto prima del punto in cui l'autopilota comincia a
    // sterzare. Non zero — premere e sterzare nello stesso istante toglierebbe
    // al gesto la sua conseguenza visibile.
    const MURO_MARGINE = 10;

    // Tolleranze attorno al muro, in unità di gioco. A ~31 unità/s
    // dell'autopilota sono ±0.10 s per la perfetta e ±0.39 s per la buona: la
    // perfetta si prende solo anticipando con gli occhi il muro che arriva, che
    // è esattamente il gesto del gioco vero.
    const MURO_PERFETTO = 3;
    const MURO_BUONO = 12;

    function clamp01(v) {
        return v < 0 ? 0 : (v > 1 ? 1 : v);
    }

    // Progressione morbida agli estremi: è ciò che rende la manovra una curva e
    // non due pieghe. Parte e arriva con derivata nulla, cioè parallela alla
    // corsia in entrambi i capi.
    function morbida(t) {
        return t * t * (3 - 2 * t);
    }

    // Come `morbida`, ma con anche la curvatura nulla agli estremi. Serve al
    // SOLO tratto finale, dove l'auto deve arrivare DRITTA nello stallo:
    // misurato sul box 0 di `prova`, a un'unità dall'arrivo si passa da 12° a
    // 4°. Il prezzo è un picco di sterzata più alto a metà manovra (36° → 43°),
    // che è esattamente il baratto giusto — il picco lo si vede di sfuggita, il
    // modo in cui l'auto si mette nel box lo si guarda.
    function morbidissima(t) {
        return t * t * t * (t * (t * 6 - 15) + 10);
    }

    // Lunghezza totale della manovra: i due tempi in fila. Non dipende da quanto
    // lo stallo è spostato — dipende da dove stanno i VICINI, che è lo stesso
    // per tutti i box della stessa corsia.
    function lunghezzaRaccordo(residuo) {
        return RACCORDO_A + lunghezzaSecondoTempo(residuo != null ? residuo : 0);
    }

    // Distanza d'arco lungo la corsia campionata fra due indici.
    function distanzaLungoLane(lane, daIdx, aIdx) {
        let d = 0;
        for (let i = Math.max(0, daIdx); i < Math.min(aIdx, lane.length - 1); i++) {
            d += Math.hypot(lane[i + 1].x - lane[i].x, lane[i + 1].z - lane[i].z);
        }
        return d;
    }

    // Il punto della corsia che sta `distanza` unità PRIMA del campione `idx`,
    // camminando all'indietro sui campioni. Restituisce anche la tangente lì,
    // che serve a chi deve orientare qualcosa (l'indicatore a terra).
    function puntoIndietroSullaLane(lane, idx, distanza) {
        let i = Math.min(idx, lane.length - 1);
        let resto = Math.max(0, distanza);
        while (i > 0 && resto > 0) {
            const seg = Math.hypot(lane[i].x - lane[i - 1].x, lane[i].z - lane[i - 1].z);
            if (seg >= resto) {
                const t = seg > 0 ? resto / seg : 0;
                const x = lane[i].x + (lane[i - 1].x - lane[i].x) * t;
                const z = lane[i].z + (lane[i - 1].z - lane[i].z) * t;
                return { x, z, idx: i - 1, tx: (lane[i].x - lane[i - 1].x) / (seg || 1), tz: (lane[i].z - lane[i - 1].z) / (seg || 1) };
            }
            resto -= seg;
            i--;
        }
        const j = Math.min(i + 1, lane.length - 1);
        const seg = Math.hypot(lane[j].x - lane[i].x, lane[j].z - lane[i].z) || 1;
        return { x: lane[i].x, z: lane[i].z, idx: i, tx: (lane[j].x - lane[i].x) / seg, tz: (lane[j].z - lane[i].z) / seg };
    }

    // Lo scostamento dallo stallo al punto di corsia da cui ci si stacca. È un
    // VETTORE, non una distanza con un segno: la corsia box è quasi dritta in
    // quel tratto, e portarsi dietro il vettore intero fa sì che alla fine del
    // raccordo si arrivi esattamente sullo stallo — non su una sua
    // approssimazione ricostruita da una normale e un modulo.
    function scostamentoStallo(lane, laneIdx, stallo) {
        const p = lane[Math.min(laneIdx, lane.length - 1)];
        const dx = stallo.x - p.x;
        const dz = stallo.z - p.z;
        return { dx, dz, modulo: Math.hypot(dx, dz) };
    }

    // Tutto quello che serve per guidare un ingresso, calcolato una volta sola
    // quando l'auto imbocca la corsia.
    // Lo scostamento del vicino da cui bisogna davvero stare lontani: il più
    // INTERNO fra i box che si superano durante la manovra, cioè quelli che
    // stanno prima lungo la corsia ed entro la lunghezza del raccordo.
    //
    // Non il più interno di tutta la fila: su `monte-rosso` gli stalli vanno da
    // 12.6 a 22.7 unità di lato, e misurare il box più esterno sul più interno
    // della fila — che sta otto posizioni più indietro e non lo si sfiora
    // nemmeno — lo costringeva a fare quasi tutto lo spostamento nel tratto
    // finale: 74° di sterzata invece di 63.
    function scostamentoViciniPrecedenti(lane, laneIdx, altriBox) {
        const L = lunghezzaRaccordo();
        let minimo = Infinity;
        for (const b of altriBox || []) {
            if (b.laneIdx == null || b.laneIdx >= laneIdx) continue;
            const distanza = distanzaLungoLane(lane, b.laneIdx, laneIdx);
            // Chi sta più indietro della manovra non lo si incrocia mai spostati:
            // in quel tratto si è ancora in mezzo alla corsia.
            if (distanza > L) continue;
            const p = lane[b.laneIdx];
            minimo = Math.min(minimo, Math.hypot(b.stallX - p.x, b.stallZ - p.z));
        }
        return Number.isFinite(minimo) ? minimo : null;
    }

    // `opzioni.scostamentoVicini`: quanto è spostato di lato lo stallo del
    // vicino che si supera durante la manovra (vedi sopra). Il proprio non
    // basta: un box più esterno dei suoi vicini, misurato su sé stesso, gli
    // passerebbe addosso. Se non lo si passa, si assume che i vicini stiano
    // dove sta lui.
    function pianoIngresso(lane, laneIdx, stallo, opzioni = {}) {
        const scostamento = scostamentoStallo(lane, laneIdx, stallo);
        const riferimento = Math.min(
            scostamento.modulo,
            opzioni.scostamentoVicini != null ? opzioni.scostamentoVicini : Infinity);
        // Quanta parte dello spostamento si fa nel primo tempo: quella che
        // porta a FASCIA_SICUREZZA dal vicino, mai oltre.
        const frazioneA = scostamento.modulo > 0
            ? clamp01((riferimento - FASCIA_SICUREZZA) / scostamento.modulo)
            : 0;
        const raccordoB = lunghezzaSecondoTempo((1 - frazioneA) * scostamento.modulo);
        const L = RACCORDO_A + raccordoB;
        return {
            laneIdx,
            scostamento,
            frazioneA,
            raccordoB,
            lunghezza: L,
            // Dove comincia a sterzare, e dove sta la zona dell'indicatore:
            // distanze in unità PRIMA del proprio box, lungo la corsia.
            inizioRaccordo: L,
            // Distanza del MURO dal proprio box, lungo la corsia. Il giudizio
            // confronta con questa: `rimanente` del muso, non dell'auto.
            muro: L + MURO_MARGINE,
        };
    }

    // La posizione sulla traiettoria d'ingresso, dato quanto manca ad arrivare
    // al proprio box (`rimanente`, in unità lungo la corsia).
    //
    // Fuori dal raccordo (rimanente > lunghezza) è semplicemente il punto della
    // corsia: il raccordo non esiste finché non serve. Dentro, ci si sposta
    // verso lo stallo con la progressione morbida.
    function posizioneIngresso(lane, piano, rimanente) {
        const base = puntoIndietroSullaLane(lane, piano.laneIdx, Math.max(0, rimanente));
        let w;
        if (rimanente >= piano.lunghezza) {
            w = 0;                                    // ancora in corsia, dritti
        } else if (rimanente >= piano.raccordoB) {
            // Primo tempo: fino al bordo della fascia di sicurezza.
            w = piano.frazioneA * morbida(clamp01(1 - (rimanente - piano.raccordoB) / RACCORDO_A));
        } else {
            // Secondo tempo: dentro il proprio stallo, superato il vicino.
            w = piano.frazioneA + (1 - piano.frazioneA) * morbidissima(clamp01(1 - rimanente / piano.raccordoB));
        }
        return {
            x: base.x + piano.scostamento.dx * w,
            z: base.z + piano.scostamento.dz * w,
            w,
        };
    }

    // Dove piantare il muro: il punto della corsia, la direzione in cui è
    // orientata lì (il muro ci sta perpendicolare) e le tolleranze, che servono
    // al client per disegnare la fascia più chiara al centro.
    function muroReazione(lane, piano) {
        const p = puntoIndietroSullaLane(lane, piano.laneIdx, piano.muro);
        return {
            x: p.x, z: p.z, tx: p.tx, tz: p.tz,
            distanzaDalBox: piano.muro,
            perfetto: MURO_PERFETTO,
            buono: MURO_BUONO,
        };
    }

    // L'esito della pressione, dato quanto manca al proprio box nell'istante in
    // cui si è premuto. Tre esiti discreti e non una scala continua (scelta
    // dell'utente): sono anche più facili da spiegare nel tutorial.
    const PERFETTA = 'perfetta';
    const BUONA = 'buona';
    const LENTA = 'lenta';

    // `rimanenteAuto` è quanto manca al proprio box misurato sul CENTRO
    // dell'auto: la funzione si sposta da sola sul muso, che è ciò che
    // attraversa il muro e ciò con cui il giocatore mira.
    function esitoDaRimanente(piano, rimanenteAuto) {
        if (rimanenteAuto == null) return LENTA;
        const muso = rimanenteAuto - SEMILUNGHEZZA_AUTO;
        const scarto = Math.abs(muso - piano.muro);
        if (scarto <= MURO_PERFETTO) return PERFETTA;
        if (scarto <= MURO_BUONO) return BUONA;
        return LENTA;
    }

    // Quanto manca al muro, in unità, per il muso dell'auto. Negativo = già
    // passato. Serve al conto alla rovescia che si legge sul pannello.
    function distanzaDalMuro(piano, rimanenteAuto) {
        return (rimanenteAuto - SEMILUNGHEZZA_AUTO) - piano.muro;
    }

    return {
        lunghezzaRaccordo, distanzaLungoLane, puntoIndietroSullaLane,
        scostamentoStallo, pianoIngresso, posizioneIngresso, muroReazione,
        scostamentoViciniPrecedenti, distanzaDalMuro,
        esitoDaRimanente, morbida, morbidissima, clamp01,
        PERFETTA, BUONA, LENTA,
        RACCORDO_A, RACCORDO_B_MIN, RACCORDO_B_MAX, FASCIA_SICUREZZA,
        lunghezzaSecondoTempo,
        MURO_MARGINE, MURO_PERFETTO, MURO_BUONO, SEMILUNGHEZZA_AUTO,
    };

});
