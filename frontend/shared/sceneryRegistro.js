// frontend/shared/sceneryRegistro.js
//
// La PORTA della scenografia: l'unico posto da cui un oggetto entra nel
// layout. Sa due cose insieme — dov'è il corridoio (carreggiata, corsia box,
// box dei piloti) e cosa è già a terra — e per questo può rispondere a una
// domanda sola: «questo ci sta?».
//
// PERCHÉ ESISTE. Prima, la lista di ciò che era già stato piazzato era un
// array che ogni costruttore riceveva e che qualcuno doveva ricordarsi di
// aggiornare. Le tribune non ci entravano mai, natura e boschi nemmeno, e il
// corridoio non c'era affatto: ogni modulo se lo ricontrollava per conto suo
// con criteri diversi. Da lì — meccanicamente — il banner dentro la tribuna,
// il pylon dentro la tribuna, il motorhome in mezzo alla pista. Rif.
// docs/superpowers/specs/2026-08-24-f1-scenografia-alla-radice-design.md.
//
// Qui il registro non è una lista da aggiornare: è la CONSEGUENZA di aver
// posato. Non si può piazzare senza registrarsi, perché è la stessa chiamata.
//
// ⚠️ COSA NON FA: non decide DOVE mettere le cose. Quello resta di ogni
// costruttore, che conosce il proprio criterio (curvatura, lato, ritmo). La
// porta dice sì o no, e ricorda.
//
// Modulo PURO: niente Three.js, niente DOM.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./sceneryAssetSizes.js'), require('./trackGeometry.js'));
    } else {
        root.SceneryRegistro = factory(root.SceneryAssetSizes, root.TrackGeometry);
    }
})(typeof self !== 'undefined' ? self : this, function (SceneryAssetSizes, TrackGeometry) {

    // Soglie in UNITÀ DI PISTA, mai in campioni: un campione vale 1.18 unità
    // su monte-rosso e 5.17 su prova, quindi «per campione» vorrebbe dire
    // quattro comportamenti diversi in silenzio.
    const MAX_DENTRO_PISTA = 0.5;      // sulla superficie di gara non ci va niente
    const MAX_DENTRO_BOX = 1.0;        // i garage lambiscono la corsia per mestiere
    // ⚠️ Sotto questa soglia è un CONTATTO, non un difetto, e va lasciato
    // stare: rifiutare ogni sfioramento costa densità senza correggere niente.
    // Misurato il 2026-08-13: toglieva 9 alberi su prova e portava le direzioni
    // spoglie dal 16% al 20%, che è il tetto del test in trackScenery.test.js.
    const MAX_COMPENETRAZIONE = 1.0;

    // Gli asset che SCAVALCANO: il ponte dei semafori e la passerella sono
    // portali, e attraversare la pista e' esattamente il loro mestiere. La
    // regola del corridoio vale per cio' che sta a TERRA — sopra passano le
    // auto. La compenetrazione con gli altri oggetti continua a valere anche
    // per loro, ma itemsOverlap confronta gia' le quote, quindi un portale
    // alto 16 non urta niente che gli stia sotto.
    const SCAVALCANO = new Set(['startGantry', 'footbridge']);

    // Le categorie che formano FILE CONTINUE per costruzione: i moduli della
    // tribuna principale sono impilati su piu' livelli allo stesso x/z, gli
    // edifici del paddock corrono attaccati lungo la corsia box, le tribune
    // normali e le pile di gomme si affiancano in schiere. Fra LORO possono
    // toccarsi quanto vogliono — e' il disegno, non un difetto: senza questa
    // esenzione la porta apre buchi in mezzo alle file, ed e' esattamente
    // quello che hanno segnalato quattro test appena diventati rossi
    // («la fila del traguardo e' unica, senza vuoti», «fronte corsia box senza
    // vuoti»).
    //
    // ⚠️ L'esenzione vale SOLO fra membri della stessa categoria, e SOLO per
    // la compenetrazione: il corridoio continua a valere per tutti. E' cio'
    // che tiene ancora preso il difetto vero di melbourne, dove sei edifici
    // del paddock entravano nella corsia box fino a 4.29 unita'.
    const FILE_CONTIGUE = new Set(['grandstand', 'grandstand-main', 'paddock', 'safety']);

    function stessaFila(a, b) {
        return a.category === b.category && FILE_CONTIGUE.has(a.category);
    }

    // Profondità di compenetrazione fra due ingombri orientati: il minimo
    // spostamento che li separerebbe (asse di minima sovrapposizione del test
    // SAT). Serve la profondità e non un sì/no — vedi la soglia qui sopra.
    function profondita(a, b) {
        const A = SceneryAssetSizes.footprintCorners(a);
        const B = SceneryAssetSizes.footprintCorners(b);
        let minimo = Infinity;
        for (const poly of [A, B]) {
            for (let i = 0; i < poly.length; i++) {
                const j = (i + 1) % poly.length;
                let nx = -(poly[j].z - poly[i].z), nz = poly[j].x - poly[i].x;
                const len = Math.hypot(nx, nz) || 1;
                nx /= len; nz /= len;
                let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
                for (const p of A) { const d = p.x * nx + p.z * nz; if (d < minA) minA = d; if (d > maxA) maxA = d; }
                for (const p of B) { const d = p.x * nx + p.z * nz; if (d < minB) minB = d; if (d > maxB) maxB = d; }
                if (maxA < minB || maxB < minA) return 0;
                const sovr = Math.min(maxA, maxB) - Math.max(minA, minB);
                if (sovr < minimo) minimo = sovr;
            }
        }
        return minimo === Infinity ? 0 : minimo;
    }

    function crea({ trackPts, pitPts, roadHalf, pitRoadHalf, playerBoxFootprints }) {
        const box = playerBoxFootprints || [];
        // Griglia spaziale: senza, il controllo è quadratico sulle ~1000 voci
        // solide di un layout, per ogni pista, in ogni test.
        const CELLA = 60;
        const griglia = new Map();

        function chiaviDi(item) {
            const r = SceneryAssetSizes.footprintRadius(item.asset) * Math.max(1, item.scale || 1);
            const out = [];
            for (let i = Math.floor((item.x - r) / CELLA); i <= Math.floor((item.x + r) / CELLA); i++)
                for (let j = Math.floor((item.z - r) / CELLA); j <= Math.floor((item.z + r) / CELLA); j++)
                    out.push(i + ',' + j);
            return out;
        }

        function registra(item) {
            for (const k of chiaviDi(item)) {
                if (!griglia.has(k)) griglia.set(k, []);
                griglia.get(k).push(item);
            }
        }

        // Quanto un ingombro entra dentro un corridoio: la penetrazione massima
        // di un suo ANGOLO oltre il bordo. Sugli angoli e non sul centro: il
        // pennone ha il pivot sull'asta e il corpo sporge tutto da un lato, e
        // col solo centro finiva dentro lo spazio di manovra dei box.
        function dentro(item, punti, mezzaLarghezza) {
            if (!punti || !punti.length) return 0;
            let peggio = 0;
            for (const c of SceneryAssetSizes.footprintCorners(item)) {
                const d = mezzaLarghezza - TrackGeometry.nearestPoint(punti, c.x, c.z).dist;
                if (d > peggio) peggio = d;
            }
            return peggio;
        }

        function motivoDiRifiuto(item) {
            if (SCAVALCANO.has(item.asset)) return motivoDaCompenetrazione(item);
            const inPista = dentro(item, trackPts, roadHalf);
            if (inPista > MAX_DENTRO_PISTA) {
                return `dentro la carreggiata di ${inPista.toFixed(2)} unità`;
            }
            const inBox = dentro(item, pitPts, pitRoadHalf);
            if (inBox > MAX_DENTRO_BOX) {
                return `dentro la corsia box di ${inBox.toFixed(2)} unità`;
            }
            const angoli = SceneryAssetSizes.footprintCorners(item);
            for (const poly of box) {
                if (SceneryAssetSizes.polysOverlap(angoli, poly)) return 'dentro un box dei piloti';
            }
            return motivoDaCompenetrazione(item);
        }

        function motivoDaCompenetrazione(item) {
            const visti = new Set();
            for (const k of chiaviDi(item)) {
                for (const altro of (griglia.get(k) || [])) {
                    if (visti.has(altro)) continue;
                    visti.add(altro);
                    if (stessaFila(item, altro)) continue;
                    if (!SceneryAssetSizes.itemsOverlap(item, altro)) continue;
                    const p = profondita(item, altro);
                    if (p > MAX_COMPENETRAZIONE) {
                        return `compenetra ${altro.category}/${altro.asset} per ${p.toFixed(2)} unità`;
                    }
                }
            }
            return null;
        }

        return {
            motivoDiRifiuto,
            profondita,
            posa(item) {
                if (motivoDiRifiuto(item)) return false;
                registra(item);
                return true;
            },
            // Per ciò che è stato deciso altrove e non è negoziabile (i box
            // dei piloti, il ponte dei semafori): il registro deve VEDERLO,
            // non giudicarlo.
            aggiungiTutti(items) {
                for (const item of items || []) if (item && item.asset) registra(item);
            },
        };
    }

    return { crea, profondita, SCAVALCANO, FILE_CONTIGUE, stessaFila, MAX_DENTRO_PISTA, MAX_DENTRO_BOX, MAX_COMPENETRAZIONE };
});
