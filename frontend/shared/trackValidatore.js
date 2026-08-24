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
        module.exports = factory(require('./trackGeometry.js'));
    } else {
        root.TrackValidatore = factory(root.TrackGeometry);
    }
})(typeof self !== 'undefined' ? self : this, function (TrackGeometry) {

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

    return {
        controllaGeometria,
        raggioMinimo, raggioAl,
        RAGGIO_MINIMO_IN_MEZZE_CARREGGIATE, PENDENZA_MASSIMA,
        RAGGIO_MINIMO_TRAGUARDO, SCARTO_MASSIMO_TRAGUARDO, GIRO_CORTO,
        META_TRIBUNA, PASSO_CURVA,
    };
});
