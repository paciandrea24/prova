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

    // Quanto prima dell'inizio del raccordo finisce la zona dell'indicatore di
    // reazione: «poco prima del punto in cui si sterza per entrare». Non zero —
    // premere e sterzare nello stesso istante toglierebbe al gesto la sua
    // conseguenza visibile.
    const INDICATORE_MARGINE = 4;
    // Lunghezza della zona in cui la pressione vale "buona", e della fascia
    // centrale in cui vale "perfetta". A ~31 unità/s dell'autopilota sono 0.77 s
    // e 0.19 s: il tempo di reazione umano sta intorno ai 250 ms, quindi la
    // fascia centrale si prende solo anticipando con gli occhi, che è il punto.
    const INDICATORE_LUNGHEZZA = 24;
    const INDICATORE_PERFETTO = 6;

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
            indicatoreFine: L + INDICATORE_MARGINE,
            indicatoreInizio: L + INDICATORE_MARGINE + INDICATORE_LUNGHEZZA,
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

    // Dove disegnare l'indicatore di reazione: due punti sulla corsia, l'inizio
    // e la fine della zona, più la fascia centrale che vale "perfetta".
    function zonaIndicatore(lane, piano) {
        const meta = (piano.indicatoreInizio + piano.indicatoreFine) / 2;
        return {
            inizio: puntoIndietroSullaLane(lane, piano.laneIdx, piano.indicatoreInizio),
            fine: puntoIndietroSullaLane(lane, piano.laneIdx, piano.indicatoreFine),
            perfettoInizio: puntoIndietroSullaLane(lane, piano.laneIdx, meta + INDICATORE_PERFETTO / 2),
            perfettoFine: puntoIndietroSullaLane(lane, piano.laneIdx, meta - INDICATORE_PERFETTO / 2),
            lunghezza: INDICATORE_LUNGHEZZA,
            lunghezzaPerfetto: INDICATORE_PERFETTO,
        };
    }

    // L'esito della pressione, dato quanto manca al proprio box nell'istante in
    // cui si è premuto. Tre esiti discreti e non una scala continua (scelta
    // dell'utente): sono anche più facili da spiegare nel tutorial.
    const PERFETTA = 'perfetta';
    const BUONA = 'buona';
    const LENTA = 'lenta';

    function esitoDaRimanente(piano, rimanente) {
        if (rimanente == null) return LENTA;
        if (rimanente > piano.indicatoreInizio || rimanente < piano.indicatoreFine) return LENTA;
        const meta = (piano.indicatoreInizio + piano.indicatoreFine) / 2;
        return Math.abs(rimanente - meta) <= INDICATORE_PERFETTO / 2 ? PERFETTA : BUONA;
    }

    return {
        lunghezzaRaccordo, distanzaLungoLane, puntoIndietroSullaLane,
        scostamentoStallo, pianoIngresso, posizioneIngresso, zonaIndicatore,
        scostamentoViciniPrecedenti,
        esitoDaRimanente, morbida, morbidissima, clamp01,
        PERFETTA, BUONA, LENTA,
        RACCORDO_A, RACCORDO_B_MIN, RACCORDO_B_MAX, FASCIA_SICUREZZA,
        lunghezzaSecondoTempo,
        INDICATORE_MARGINE, INDICATORE_LUNGHEZZA, INDICATORE_PERFETTO,
    };

});
