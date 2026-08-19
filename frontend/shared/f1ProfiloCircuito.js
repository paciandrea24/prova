// frontend/shared/f1ProfiloCircuito.js
//
// Che circuito è questo, in numeri: quanto è lungo, quanti giri, e le quattro
// barrette che nel riferimento Pirelli riassumono il carattere della pista.
//
// LE BARRETTE. Nell'infografica vera (trazione, stress gomme, frenata, carico
// aerodinamico…) sono valutazioni editoriali: le decide un ingegnere guardando
// i dati del weekend. Da noi non ci sarebbe nessuno a deciderle — ma la
// geometria del tracciato le contiene già, ed è misurabile. Una pista fatta di
// tornanti chiede trazione e frenata; una fatta di curvoni veloci chiede carico
// aerodinamico e distrugge le gomme di lato. Quindi non sono inventate né
// copiate: si contano le curve e i rettilinei del tracciato reale.
//
// QUELLE CHE NON CI SONO. `abrasione dell'asfalto` ed `evoluzione della pista`
// stanno nel riferimento ma non qui, e non è una dimenticanza: sono proprietà
// del MANTO, non della forma. Un circuito nel gioco non ha un asfalto più o
// meno ruvido, quindi qualunque numero avremmo messo sarebbe stato una
// decorazione — e una decorazione che sembra un dato è peggio di niente.
//
// L'UNITÀ. Nel gioco un'unità di mondo vale un metro: lo stabilisce
// `TrackGeometry.lapsForDistance`, che divide i metri richiesti per la
// lunghezza del giro in unità. Tutto quello che qui diventa "km" passa di lì.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(
        typeof require === 'function' ? require('./trackGeometry.js') : null);
    else root.F1ProfiloCircuito = factory(root.TrackGeometry);
})(typeof self !== 'undefined' ? self : this, function (TrackGeometry) {

    // Un'unità di mondo = un metro (vedi sopra).
    const METRI_PER_UNITA = 1;

    // Accelerazione laterale di riferimento per stimare a che velocità si
    // affronta una curva di raggio r: v = √(a·r). Non deve essere il valore
    // esatto della fisica — serve solo a ORDINARE le curve fra loro, e un
    // errore di scala si annulla nella normalizzazione delle barrette.
    const ACCEL_LATERALE = 14;

    // Velocità massima dell'auto in metri al secondo (≈340 km/h, il tetto della
    // fisica del gioco). Serve a sapere quando una curva è così larga da essere
    // limitata dal motore invece che dall'aderenza.
    const VEL_MAX = 94;

    // Sotto questo raggio (in unità) una curva è "lenta": è da lì che si esce in
    // trazione, ed è lì che si frena forte.
    const RAGGIO_LENTO = 90;
    // Sopra questo raggio il tratto è praticamente dritto e non conta come curva.
    const RAGGIO_DRITTO = 600;

    // Ogni quanti campioni si valuta la curvatura. Troppo fitto e si misura il
    // rumore del campionamento, troppo rado e le curve corte spariscono.
    const PASSO = 6;

    function clamp(v, min, max) {
        return v < min ? min : (v > max ? max : v);
    }

    // Raggio di curvatura in ogni punto del giro, in unità.
    //
    // `curvatureAt` restituisce un OGGETTO { radius, turnSigned }, non un
    // numero: leggerlo come se fosse una curvatura da invertire dà NaN, il
    // confronto con la soglia è falso, e tutte le piste risultano perfettamente
    // dritte — cioè tutte le barrette a 1, senza che niente si lamenti.
    function raggi(points) {
        const out = [];
        for (let i = 0; i < points.length; i += PASSO) {
            out.push(TrackGeometry.curvatureAt(points, i).radius);
        }
        return out;
    }

    // Da un valore continuo a una barretta 1-5. Le soglie sono tarate sui
    // circuiti esistenti (vedi il test): non è una normalizzazione sul minimo e
    // massimo dei circuiti caricati, che farebbe cambiare il profilo di una
    // pista solo perché ne è stata aggiunta un'altra.
    function barretta(valore, soglie) {
        let n = 1;
        for (const s of soglie) if (valore >= s) n++;
        return clamp(n, 1, 5);
    }

    // ── Le quattro misure ───────────────────────────────────────────────────

    // TRAZIONE: quanta parte del giro si passa a uscire da curve lente.
    function trazione(rs) {
        const lente = rs.filter(r => r < RAGGIO_LENTO).length;
        return lente / rs.length;
    }

    // STRESS GOMME: quanto lavoro si chiede alle gomme lungo il giro.
    //
    // Non è "quanta parte del giro è in curva" — quella era la prima versione,
    // e restituiva quasi esattamente la somma delle altre due barrette: una
    // misura che non aggiunge niente a quelle che ci sono già è peggio che
    // assente, perché occupa una riga e sembra dire qualcosa.
    //
    // Qui si stima la POTENZA dissipata di lato, che è ciò che consuma davvero
    // una gomma: forza laterale × velocità con cui si striscia. La velocità in
    // curva è il minimo fra quella che il grip concede (√(a·r)) e quella che
    // l'auto raggiunge in fondo; da lì l'accelerazione laterale effettiva è
    // v²/r. Il risultato distingue quello che l'intuizione dice: un curvone
    // veloce mangia le gomme più di un tornante, anche se sul tornante si
    // sterza di più.
    function stressGomme(rs) {
        let somma = 0;
        for (const r of rs) {
            if (!Number.isFinite(r) || r > RAGGIO_DRITTO) continue;
            const v = Math.min(VEL_MAX, Math.sqrt(ACCEL_LATERALE * r));
            const aLat = (v * v) / r;
            somma += aLat * v;
        }
        // Normalizzato sul caso peggiore immaginabile: tutto il giro percorso
        // alla massima accelerazione laterale e alla massima velocità.
        const massimo = rs.length * ACCEL_LATERALE * VEL_MAX;
        return massimo > 0 ? somma / massimo : 0;
    }

    // FRENATA: quante volte per chilometro si passa da un tratto veloce a una
    // curva lenta. È il conto delle staccate, che è ciò che la barretta dice.
    function frenata(rs, lunghezzaKm) {
        let staccate = 0;
        let eraVeloce = true;
        for (const r of rs) {
            const veloce = r > RAGGIO_DRITTO;
            if (eraVeloce && r < RAGGIO_LENTO) { staccate++; eraVeloce = false; }
            if (veloce) eraVeloce = true;
        }
        return lunghezzaKm > 0 ? staccate / lunghezzaKm : 0;
    }

    // CARICO AERODINAMICO: quanta parte del giro sta in curve VELOCI, quelle che
    // si prendono col carico e non col freno.
    function caricoAero(rs) {
        const veloci = rs.filter(r => r >= RAGGIO_LENTO && r <= RAGGIO_DRITTO).length;
        return veloci / rs.length;
    }

    // Soglie misurate sui circuiti esistenti (vedi f1ProfiloCircuito.test.js,
    // che verifica che restino discriminanti: se un giorno tutte le piste
    // dessero la stessa barretta, quella barretta non direbbe più niente).
    // Misurati sui circuiti esistenti (2026-08-19):
    //   monte-rosso  trazione 0.048  stress 0.579  frenata 0.85  aero 0.910
    //   new-monza    trazione 0.156  stress 0.256  frenata 1.87  aero 0.329
    //   prova        trazione 0.144  stress 0.397  frenata 1.74  aero 0.575
    // Le soglie li separano tutti e tre su ogni riga, lasciando spazio sia sotto
    // (un ovale) sia sopra (un cittadino) per i circuiti che verranno.
    const SOGLIE = {
        trazione:   [0.04, 0.09, 0.15, 0.24],
        stress:     [0.20, 0.32, 0.45, 0.62],
        frenata:    [0.6, 1.2, 1.8, 2.6],
        caricoAero: [0.25, 0.42, 0.60, 0.80],
    };

    // Il profilo completo di un tracciato.
    //
    // `points` sono i campioni del giro (gli stessi che il gioco usa per
    // disegnarlo), `targetKm` la distanza di gara voluta, dal file della pista.
    function profilo(points, targetKm) {
        const lunghezzaUnita = TrackGeometry.lapLength(points);
        const lunghezzaKm = (lunghezzaUnita * METRI_PER_UNITA) / 1000;
        const giri = TrackGeometry.lapsForDistance(lunghezzaUnita, targetKm);
        const rs = raggi(points);

        return {
            giri,
            lunghezzaKm,
            distanzaKm: lunghezzaKm * giri,
            // I valori grezzi restano accanto alle barrette: servono ai test per
            // dire QUANTO una pista è diversa da un'altra, che una scala a
            // cinque gradini non può più distinguere.
            misure: {
                trazione: trazione(rs),
                stress: stressGomme(rs),
                frenata: frenata(rs, lunghezzaKm),
                caricoAero: caricoAero(rs),
            },
            barrette: {
                trazione: barretta(trazione(rs), SOGLIE.trazione),
                stress: barretta(stressGomme(rs), SOGLIE.stress),
                frenata: barretta(frenata(rs, lunghezzaKm), SOGLIE.frenata),
                caricoAero: barretta(caricoAero(rs), SOGLIE.caricoAero),
            },
        };
    }

    return {
        profilo, raggi, barretta,
        trazione, stressGomme, frenata, caricoAero,
        SOGLIE, RAGGIO_LENTO, RAGGIO_DRITTO, PASSO, METRI_PER_UNITA, ACCEL_LATERALE, VEL_MAX,
    };

});
