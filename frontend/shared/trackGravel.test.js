// frontend/shared/trackGravel.test.js
const test = require('node:test');
const assert = require('node:assert');
const TrackGravel = require('./trackGravel.js');
const TrackGeometry = require('./trackGeometry.js');

// Ovale: due semicerchi di raggio 60 uniti da due rettilinei da 400.
// Stessa forma del test di findCorners, così le due suite parlano della
// stessa geometria.
function ovale({ y = 0, bridge = false } = {}) {
    const pts = [];
    const push = (x, z) => pts.push({ x, z, y, bridge });
    for (let i = 0; i < 100; i++) push(-200 + i * 4, -60);
    for (let i = 0; i < 60; i++) {
        const a = -Math.PI / 2 + (i / 60) * Math.PI;
        push(200 + Math.cos(a) * 60, Math.sin(a) * 60);
    }
    for (let i = 0; i < 100; i++) push(200 - i * 4, 60);
    for (let i = 0; i < 60; i++) {
        const a = Math.PI / 2 + (i / 60) * Math.PI;
        push(-200 + Math.cos(a) * 60, Math.sin(a) * 60);
    }
    return pts;
}

// Larghezza attesa al centro di una curva dell'ovale: la stessa che il
// modulo dichiara, non un numero ricopiato a mano — così il test regge se la
// taratura cambia, e fallisce solo se cambia il COMPORTAMENTO.
function larghezzaAttesa(pts, c) {
    const n = pts.length;
    const stepLen = TrackGeometry.lapLength(pts) / n;
    const lunghezzaZona = ((c.endIdx - c.startIdx + n) % n) * stepLen + 2 * TrackGravel.CORNER_LEAD;
    return TrackGravel.cornerGravelWidth(c.minRadius, lunghezzaZona);
}

test('la ghiaia esiste solo in curva e solo sul lato esterno', () => {
    const pts = ovale();
    const prof = TrackGravel.gravelProfile(pts, { roadHalf: 11 });
    const curve = TrackGeometry.findCorners(pts);
    assert.ok(curve.length > 0, 'il caso di prova deve avere curve');

    // Al centro di ogni curva: ghiaia piena sull'esterno, zero sull'interno.
    for (const c of curve) {
        assert.equal(TrackGravel.gravelAt(prof, c.midIdx, c.side),
            larghezzaAttesa(pts, c), 'ghiaia piena sul lato esterno');
        assert.equal(TrackGravel.gravelAt(prof, c.midIdx, -c.side), 0,
            'niente ghiaia sul lato interno');
    }

    // Al centro del primo rettilineo (indice 50): niente ghiaia da nessun lato.
    assert.equal(TrackGravel.gravelAt(prof, 50, 1), 0);
    assert.equal(TrackGravel.gravelAt(prof, 50, -1), 0);
});

test('una curva veloce ha piu\' ghiaia di una lenta, a parita\' di spazio', () => {
    // Stessa lunghezza di zona per entrambe, così l'unica variabile è il
    // raggio: 100 unità si percorrono quasi a tavoletta, 25 sono un tornante.
    const zona = 600;   // abbondante: la regola del pianoro non interviene
    const veloce = TrackGravel.cornerGravelWidth(100, zona);
    const media  = TrackGravel.cornerGravelWidth(55, zona);
    const lenta  = TrackGravel.cornerGravelWidth(25, zona);

    assert.ok(veloce > media && media > lenta,
        `attesa ghiaia decrescente col raggio, ottenute ${veloce.toFixed(1)} / ${media.toFixed(1)} / ${lenta.toFixed(1)}`);
    assert.ok(lenta >= TrackGravel.GRAVEL_WIDTH_MIN,
        'nemmeno il tornante più lento scende sotto il minimo');
});

test('la velocita\' di percorrenza sale col raggio e non supera il massimo', () => {
    assert.ok(TrackGravel.cornerSpeed(30) < TrackGravel.cornerSpeed(60),
        'una curva più larga si percorre più forte');
    assert.equal(TrackGravel.cornerSpeed(100000), TrackGravel.MAX_SPEED,
        'un rettilineo si percorre alla velocità massima, non oltre');
    // Relazione esatta: a regime la velocità è raggio x tasso di sterzata, e
    // il tasso a quella velocità è interpolato fra LOW e HIGH. Verificarla
    // qui evita che la formula si scolli dalla fisica che imita.
    const r = 70, v = TrackGravel.cornerSpeed(r);
    const tasso = TrackGravel.TURN_SPEED_LOW
        + (TrackGravel.TURN_SPEED_HIGH - TrackGravel.TURN_SPEED_LOW) * (v / TrackGravel.MAX_SPEED);
    assert.ok(Math.abs(v - r * tasso) < 1e-9,
        `velocità ${v} incoerente con raggio x tasso di sterzata ${r * tasso}`);
});

test('una curva troppo corta riduce la ghiaia invece di farla a punta', () => {
    // Stessa curva veloce, due spazi diversi. Con zona abbondante prende la
    // larghezza che le spetta; con zona corta la larghezza scende quanto
    // basta perché metà fascia resti piana — è la regola contro la "ghiaia a
    // goccia", il difetto che si vedeva sulla curva più veloce di prova.
    const larga = TrackGravel.cornerGravelWidth(100, 600);
    const stretta = TrackGravel.cornerGravelWidth(100, 90);
    assert.ok(stretta < larga, 'la curva corta riceve meno ghiaia');
    assert.ok(Math.abs(stretta - 90 / 4) < 1e-9,
        `attesa lunghezzaZona/4 = 22.5, ottenuta ${stretta.toFixed(2)}`);

    // Il pianoro (zona meno le due rampe, lunghe quanto la larghezza) non
    // scende mai sotto la metà della zona, su nessuna combinazione.
    for (const raggio of [20, 35, 50, 70, 90, 115]) {
        for (const zona of [60, 90, 140, 250, 600]) {
            const w = TrackGravel.cornerGravelWidth(raggio, zona);
            const pianoro = zona - 2 * w;
            assert.ok(pianoro >= zona / 2 - 1e-9 || w === TrackGravel.GRAVEL_WIDTH_MIN,
                `raggio ${raggio}, zona ${zona}: pianoro ${pianoro.toFixed(1)} su ${zona}, larghezza ${w.toFixed(1)}`);
        }
    }
});

test('il profilo non ha gradini: la pendenza resta entro MAX_SLOPE', () => {
    const pts = ovale();
    const prof = TrackGravel.gravelProfile(pts, { roadHalf: 11 });
    const n = prof.left.length;
    // La soglia è una PENDENZA (larghezza per unità di pista), non un salto
    // per campione: campioni lunghi tollerano salti proporzionalmente più
    // grandi, ed è ciò che rende il criterio uguale su piste diverse.
    const stepLen = TrackGeometry.lapLength(pts) / n;
    const saltoMax = TrackGravel.MAX_SLOPE * stepLen;
    for (const lato of ['left', 'right']) {
        for (let i = 0; i < n; i++) {
            const d = Math.abs(prof[lato][(i + 1) % n] - prof[lato][i]);
            assert.ok(d <= saltoMax + 1e-9,
                `salto di ${d.toFixed(2)} su ${lato} al campione ${i}, massimo ${saltoMax.toFixed(2)}`);
        }
    }
});

test('niente ghiaia sui tratti a ponte né dove la pista è sopraelevata', () => {
    const suPonte = TrackGravel.gravelProfile(ovale({ bridge: true }), { roadHalf: 11 });
    assert.ok(suPonte.left.every(v => v === 0) && suPonte.right.every(v => v === 0),
        'un tracciato tutto su ponte non ha ghiaia');

    const inQuota = TrackGravel.gravelProfile(ovale({ y: 8 }), { roadHalf: 11 });
    assert.ok(inQuota.left.every(v => v === 0) && inQuota.right.every(v => v === 0),
        'un tracciato tutto sopraelevato non ha ghiaia');
});

test('la corsia box vicina toglie la ghiaia', () => {
    const pts = ovale();
    const senza = TrackGravel.gravelProfile(pts, { roadHalf: 11 });
    const curve = TrackGeometry.findCorners(pts);
    const c = curve[0];
    // Corsia box che passa proprio dove ci sarebbe la ghiaia della prima curva.
    const { nx, nz } = TrackGeometry.normalAt(pts, c.midIdx, true);
    const p = pts[c.midIdx];
    const pit = [];
    for (let k = -20; k <= 20; k++) {
        pit.push({ x: p.x + nx * 20 * c.side + k * 2, z: p.z + nz * 20 * c.side });
    }
    const con = TrackGravel.gravelProfile(pts, { roadHalf: 11, pitLanePts: pit, pitRoadHalf: 5 });
    assert.ok(TrackGravel.gravelAt(senza, c.midIdx, c.side) > 0, 'senza corsia box c\'è ghiaia');
    assert.ok(TrackGravel.gravelAt(con, c.midIdx, c.side) <
              TrackGravel.gravelAt(senza, c.midIdx, c.side),
        'la corsia box vicina riduce o azzera la ghiaia');
});

test('pitGapSamples tiene solo i punti vicini ai due estremi della corsia', () => {
    // Corsia rettilinea lunga 400 unità, un punto ogni 2 unità.
    const pit = [];
    for (let i = 0; i <= 200; i++) pit.push({ x: i * 2, z: 0 });

    const gap = TrackGravel.pitGapSamples(pit);
    assert.ok(gap.length > 0 && gap.length < pit.length, 'né vuoto né tutto');

    // Il primo e l'ultimo punto ci sono sempre; quello di mezzo mai.
    const ha = (x) => gap.some(p => p.x === x);
    assert.ok(ha(0), 'il primo punto è nel varco');
    assert.ok(ha(400), 'l\'ultimo punto è nel varco');
    assert.ok(!ha(200), 'il punto centrale non è nel varco');

    // Il confine è PIT_MERGE_WINDOW = 75 unità dagli estremi.
    assert.ok(ha(74), 'a 74 unità dall\'inizio è ancora varco');
    assert.ok(!ha(76), 'a 76 unità dall\'inizio non lo è più');
});

// ---- barrierProfile: la pista chiusa ----

const ROAD_HALF = 11;
const BORDO_CORDOLO = ROAD_HALF + TrackGravel.CURB_W;
const STORICA = BORDO_CORDOLO + TrackGravel.BARRIER_GAP;   // dov'era la barriera prima

test('barrierProfile: sui rettilinei la barriera arretra della via di fuga minima', () => {
    const pts = ovale();
    const bar = TrackGravel.barrierProfile(pts, { roadHalf: ROAD_HALF });
    // Indice 50: centro del primo rettilineo, lontano da curve e ponti.
    for (const side of [-1, 1]) {
        assert.equal(TrackGravel.barrierAt(bar, 50, side),
            BORDO_CORDOLO + TrackGravel.RUNOFF_MIN,
            'in rettilineo la barriera sta a cordolo + via di fuga minima');
    }
});

test('barrierProfile: la barriera non si avvicina MAI rispetto a dov\'era', () => {
    // È la garanzia che rende la modifica sicura: chiudere la pista può solo
    // allontanare il muro, mai stringerlo addosso a chi guida.
    const pts = ovale();
    const bar = TrackGravel.barrierProfile(pts, { roadHalf: ROAD_HALF });
    for (let i = 0; i < pts.length; i++) {
        for (const side of [-1, 1]) {
            const d = TrackGravel.barrierAt(bar, i, side);
            assert.ok(d >= STORICA - 1e-9,
                `campione ${i} lato ${side}: barriera a ${d.toFixed(1)}, più vicina della storica ${STORICA}`);
        }
    }
});

test('barrierProfile: la banda di ghiaia non esce mai da sotto il muro', () => {
    // `bar.gravel` è la ghiaia RIFILATA sul muro, ed è quella da disegnare:
    // dove il livellamento ha dovuto abbassare la barriera, la banda si
    // accorcia con lei invece di sbucarne fuori.
    const pts = ovale({ bridge: false });
    const bar = TrackGravel.barrierProfile(pts, { roadHalf: ROAD_HALF });
    for (let i = 0; i < pts.length; i++) {
        for (const side of [-1, 1]) {
            const ghiaia = TrackGravel.gravelAt(bar.gravel, i, side);
            assert.ok(ghiaia >= 0, 'la ghiaia rifilata non può essere negativa');
            assert.ok(TrackGravel.barrierAt(bar, i, side) >= BORDO_CORDOLO + ghiaia - 1e-9,
                `campione ${i}: la barriera taglierebbe la banda di ghiaia`);
        }
    }
    // E su un ovale senza ponti né corsia box la ghiaia NON viene rifilata
    // affatto: il muro le fa posto tutto.
    //
    // Per una sera (2026-08-12) qui si pretendeva invece `min(piena,
    // RUNOFF_MAX)`, perché un tetto fisso a 16 tosava le vie di fuga più
    // larghe. Quel tetto non c'è più: a limitare il muro resta solo il tetto
    // geometrico, che morde dove il raggio della curva non regge la distanza.
    // Sull'ovale le curve hanno raggio 60 contro un muro a 21 dal cordolo,
    // quindi non morde: misurata una rifilatura di 0.0000 su tutti i
    // campioni. Se un domani questo test tornasse rosso, la domanda giusta è
    // "che raggio ha la curva rispetto alla via di fuga che chiede", non
    // "di quanto va alzato un tetto".
    const piena = TrackGravel.gravelProfile(pts, { roadHalf: ROAD_HALF });
    for (let i = 0; i < pts.length; i++) {
        for (const lato of ['left', 'right']) {
            assert.ok(Math.abs(bar.gravel[lato][i] - piena[lato][i]) < 1e-9,
                `campione ${i} ${lato}: ghiaia ${bar.gravel[lato][i].toFixed(2)}, attesa ${piena[lato][i].toFixed(2)}`);
        }
    }
});

test('barrierProfile: sui ponti il muro resta stretto come oggi', () => {
    const suPonte = TrackGravel.barrierProfile(ovale({ bridge: true }), { roadHalf: ROAD_HALF });
    for (let i = 0; i < suPonte.left.length; i++) {
        for (const side of [-1, 1]) {
            assert.equal(TrackGravel.barrierAt(suPonte, i, side),
                ROAD_HALF + TrackGravel.BRIDGE_MARGIN,
                'su un viadotto non c\'è terreno attorno: il muro resta a bordo strada');
        }
    }
});

test('barrierProfile: dove corre la corsia box la barriera non si sposta', () => {
    // È la zona del traguardo e dei box, che l'utente vuole invariata.
    const pts = ovale();
    const c = TrackGeometry.findCorners(pts)[0];
    // Corsia box parallela al primo rettilineo, dal lato +1.
    const pit = [];
    for (let k = 0; k <= 60; k++) {
        const p = pts[20 + k];
        const { nx, nz } = TrackGeometry.normalAt(pts, 20 + k, true);
        pit.push({ x: p.x + nx * 40, z: p.z + nz * 40 });
    }
    const bar = TrackGravel.barrierProfile(pts, { roadHalf: ROAD_HALF, pitLanePts: pit, pitRoadHalf: 5 });
    assert.equal(TrackGravel.barrierAt(bar, 50, 1), STORICA,
        'accanto alla corsia box la barriera resta dov\'era');
    assert.equal(TrackGravel.barrierAt(bar, 50, -1), STORICA,
        'la zona protegge entrambi i lati, non solo quello dei box');
    // Lontano dalla corsia (dall\'altra parte del giro) la via di fuga c\'è.
    assert.ok(TrackGravel.barrierAt(bar, 250, 1) > STORICA,
        'fuori dalla zona box la barriera arretra');
    assert.ok(c, 'il caso di prova deve avere curve');
});

test('barrierProfile: nessun gradino nel muro, la pendenza resta entro MAX_SLOPE', () => {
    const pts = ovale();
    const n = pts.length;
    const stepLen = TrackGeometry.lapLength(pts) / n;
    const saltoMax = TrackGravel.MAX_SLOPE * stepLen;
    // Caso peggiore: corsia box che crea una zona protetta in mezzo al giro,
    // quindi due transizioni da 1.2 a 20 unità di via di fuga.
    const pit = [];
    for (let k = 0; k <= 60; k++) {
        const p = pts[20 + k];
        const { nx, nz } = TrackGeometry.normalAt(pts, 20 + k, true);
        pit.push({ x: p.x + nx * 40, z: p.z + nz * 40 });
    }
    const bar = TrackGravel.barrierProfile(pts, { roadHalf: ROAD_HALF, pitLanePts: pit, pitRoadHalf: 5 });
    for (const lato of ['left', 'right']) {
        for (let i = 0; i < n; i++) {
            const d = Math.abs(bar[lato][(i + 1) % n] - bar[lato][i]);
            assert.ok(d <= saltoMax + 1e-9,
                `gradino di ${d.toFixed(2)} su ${lato} al campione ${i}, massimo ${saltoMax.toFixed(2)}`);
        }
    }
});

test('barrierProfile: nel tratto del traguardo il muro resta stretto e senza ghiaia', () => {
    // La corsia box corre da un lato solo, ma il tratto va tenuto com'è su
    // ENTRAMBI: è la richiesta dell'utente ("mi piace al momento"). Prima la
    // ghiaia di una curva dentro quel tratto spingeva fuori il muro sul lato
    // opposto e lo faceva andare a fisarmonica — misurato su prova, lato
    // destro: 15 -> 39.6 -> 45.7 -> 29.3 -> 15 -> 33.8 nel giro di 200 unità.
    const pts = ovale();
    // Corsia box lungo il primo rettilineo, dal lato interno: tocca solo
    // quello, mentre le curve dell'ovale hanno ghiaia da entrambe le parti.
    const pit = [];
    for (let k = 0; k <= 40; k++) pit.push({ x: -160 + k * 8, z: -60 + 25 });

    const prof = TrackGravel.barrierProfile(pts, { roadHalf: ROAD_HALF, pitLanePts: pit, pitRoadHalf: 5 });

    let protetti = 0;
    for (let i = 0; i < pts.length; i++) {
        if (TrackGeometry.nearestPoint(pit, pts[i].x, pts[i].z).dist >= TrackGravel.PIT_STRAIGHT_REACH) continue;
        protetti++;
        for (const lato of ['left', 'right']) {
            assert.ok(prof[lato][i] <= STORICA + 0.01,
                `campione ${i} lato ${lato}: muro a ${prof[lato][i].toFixed(1)} invece di ${STORICA} nel tratto dei box`);
            assert.equal(prof.gravel[lato][i], 0,
                `campione ${i} lato ${lato}: ghiaia nel tratto dei box`);
        }
    }
    assert.ok(protetti > 10, 'il caso di prova deve avere un tratto protetto vero');
});

test('barrierProfile: la barriera non finisce sul territorio di un altro tratto', () => {
    // Ovale stretto: due rettilinei a 60 unità l'uno dall'altro, uniti da
    // semicerchi di raggio 30. Lo spazio è conteso — dalla mezzeria in poi il
    // terreno appartiene al tratto di fronte, che lo disegna alla PROPRIA
    // quota. Una barriera piazzata di là si ritrova appoggiata su un terreno
    // che non è il suo: ci affonda dentro o ci fluttua sopra, come segnalato
    // in gioco dall'utente il 2026-08-12.
    const pts = [];
    const push = (x, z) => pts.push({ x, z, y: 0, bridge: false });
    for (let k = 0; k < 100; k++) push(-200 + k * 4, -30);
    for (let k = 0; k < 24; k++) { const a = -Math.PI / 2 + k / 24 * Math.PI; push(200 + Math.cos(a) * 30, Math.sin(a) * 30); }
    for (let k = 0; k < 100; k++) push(200 - k * 4, 30);
    for (let k = 0; k < 24; k++) { const a = Math.PI / 2 + k / 24 * Math.PI; push(-200 + Math.cos(a) * 30, Math.sin(a) * 30); }

    const prof = TrackGravel.barrierProfile(pts, { roadHalf: ROAD_HALF });
    const n = pts.length;
    const cum = [0];
    for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    const giro = cum[n - 1] + Math.hypot(pts[0].x - pts[n - 1].x, pts[0].z - pts[n - 1].z);

    let peggiore = 0, dove = null;
    for (let i = 0; i < n; i++) {
        const { nx, nz } = TrackGeometry.normalAt(pts, i, true);
        for (const side of [-1, 1]) {
            const d = TrackGravel.barrierAt(prof, i, side);
            const bx = pts[i].x + nx * d * side, bz = pts[i].z + nz * d * side;
            // Il punto più vicino fra i campioni di un ALTRO tratto: se è più
            // vicino di quanto lo sia il campione che genera la barriera, la
            // barriera sta di là.
            for (let j = 0; j < n; j++) {
                let ds = Math.abs(cum[j] - cum[i]);
                if (giro - ds < ds) ds = giro - ds;
                if (ds < TrackGeometry.NEIGHBOUR_KIN_SPAN) continue;
                const sconfino = d - Math.hypot(pts[j].x - bx, pts[j].z - bz);
                if (sconfino > peggiore) { peggiore = sconfino; dove = { i, side, d }; }
            }
        }
    }
    assert.ok(peggiore < 0.5,
        `la barriera sconfina di ${peggiore.toFixed(2)} unità nel territorio del tratto vicino` +
        (dove ? ` (campione ${dove.i}, barriera a ${dove.d.toFixed(1)} dall'asse)` : ''));
});

test('barrierDistAt somma la ghiaia alla distanza base', () => {
    const pts = ovale();
    const prof = TrackGravel.gravelProfile(pts, { roadHalf: 11 });
    const c = TrackGeometry.findCorners(pts)[0];
    const base = 15;
    assert.equal(TrackGravel.barrierDistAt(prof, 50, 1, base), base,
        'sul rettilineo la barriera resta dov\'è oggi');
    assert.equal(TrackGravel.barrierDistAt(prof, c.midIdx, c.side, base),
        base + larghezzaAttesa(pts, c));
});

// ---- barrierProfile: il nastro della barriera non si ripiega ----
//
// La barriera è la pista spostata lungo la normale: sul lato interno di una
// curva, oltre il raggio di curvatura il punto di barriera INDIETREGGIA e il
// nastro si ripiega su se stesso, formando prima una cuspide e poi un cappio.
// In gioco l'utente lo ha visto come "groviglio di barriere" ai campioni 132,
// 337, 646 e 764 di `prova` (2026-08-12), e la misura ha ritrovato le zone
// annodate esattamente lì.
//
// Il test misura i VERTICI con la stessa formula del costruttore della mesh
// (trackMeshBuilder.js::buildBarriers), non il profilo: un profilo liscio può
// benissimo produrre un nastro ripiegato, ed è proprio quello che succedeva.
const fs = require('fs');
const path = require('path');

// Le piste si leggono dalla cartella invece di elencarle a mano: un elenco
// scritto nel test invecchia, e si rompe quando una pista viene aggiunta o
// rimossa (successo con `baku`, tolta il 2026-08-17).
const TRACCIATI = require('fs')
    .readdirSync(require('path').join(__dirname, '..', 'tracks'))
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace(/\.json$/, ''));

function pistaVera(id) {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tracks', `${id}.json`), 'utf8'));
    return { raw, pts: TrackGeometry.sampleLoop(raw.controlPoints, 1000) };
}

function ripiegamentiDi(pts, distDi) {
    const n = pts.length;
    const out = [];
    for (const side of [-1, 1]) {
        for (let i = 0; i < n; i++) {
            const prev = (i - 1 + n) % n;
            const t = TrackGeometry.tangentAt(pts, prev, true);
            const nQui = TrackGeometry.normalAt(pts, i, true);
            const avanti = (pts[i].x - pts[prev].x) * t.tx + (pts[i].z - pts[prev].z) * t.tz
                + side * distDi(i, side) * (nQui.nx * t.tx + nQui.nz * t.tz);
            if (avanti <= 0) out.push(`${side > 0 ? 'dx' : 'sx'}${i}`);
        }
    }
    return out;
}

for (const id of TRACCIATI) {
    test(`barrierProfile: il nastro non si ripiega (${id})`, () => {
        const { raw, pts } = pistaVera(id);
        const bar = TrackGravel.barrierProfile(pts, { roadHalf: raw.roadHalfWidth });
        const storica = raw.roadHalfWidth + TrackGravel.CURB_W + TrackGravel.BARRIER_GAP;

        // Riferimento: il muro alla distanza storica, cioè la regola in vigore
        // prima delle vie di fuga. Su baku qualche curva ha raggio 9.9 con
        // pista di semi-larghezza 11 — il centro di curvatura cade dentro
        // l'asfalto e NESSUNA barriera interna è possibile, a nessuna
        // distanza. Quello che le vie di fuga non possono fare è peggiorare
        // il conto: il limite è del tracciato, non di questo modulo.
        const prima = ripiegamentiDi(pts, () => storica);
        const adesso = ripiegamentiDi(pts, (i, side) => TrackGravel.barrierAt(bar, i, side));

        assert.ok(adesso.length <= prima.length,
            `${id}: ${adesso.length} ripiegamenti contro i ${prima.length} del muro storico — ${adesso.slice(0, 8).join(' ')}`);
        if (prima.length === 0) {
            assert.equal(adesso.length, 0,
                `${id}: il muro storico non si ripiegava, questo sì — ${adesso.slice(0, 8).join(' ')}`);
        }
    });
}

test('la ghiaia cresce con la velocità della curva, oltre la base di 16', () => {
    const { raw, pts } = pistaVera('prova');
    const bar = TrackGravel.barrierProfile(pts, { roadHalf: raw.roadHalfWidth });
    const bordoCordolo = raw.roadHalfWidth + TrackGravel.CURB_W;

    let massimo = 0;
    for (let i = 0; i < pts.length; i++) {
        for (const side of [-1, 1]) {
            massimo = Math.max(massimo, TrackGravel.barrierAt(bar, i, side) - bordoCordolo);
        }
    }
    // Su prova le curve veloci chiedono 20.7, 22, 25.1 e 31.9 unità di
    // ghiaia: se il muro non supera mai RUNOFF_MIN significa che un tetto
    // fisso le sta tosando tutte, e le vie di fuga non raccontano più che
    // curva sia.
    assert.ok(massimo > TrackGravel.RUNOFF_MIN + 2,
        `il muro non supera mai ${TrackGravel.RUNOFF_MIN} dal cordolo (massimo ${massimo.toFixed(1)}): la ghiaia non cresce più con la curva`);
});

test('nelle curve strette il muro scende su tutto l\'arco, non solo sull\'apice', () => {
    const { raw, pts } = pistaVera('prova');
    const bar = TrackGravel.barrierProfile(pts, { roadHalf: raw.roadHalfWidth });
    const n = pts.length;

    // Curva 126-144 di prova, raggio 40.4: è una di quelle in cui il tetto
    // morde. Se il muro scende solo sull'apice, la distanza ha una V stretta;
    // se scende su tutto l'arco, i campioni vicini all'apice stanno entro
    // poco dal minimo.
    //
    // ⚠️ Il lato è il +1 (destro), che qui è l'INTERNO della curva: è lì che
    // il nastro si ripiegava (dx133, dx134, dx135 nella misura del
    // 2026-08-12). Sul lato esterno il tetto non interviene mai e il test
    // passerebbe sempre, anche col muro a punta.
    const apice = 134;
    const dApice = TrackGravel.barrierAt(bar, apice, 1);
    for (const off of [-6, -4, 4, 6]) {
        const d = TrackGravel.barrierAt(bar, (apice + off + n) % n, 1);
        assert.ok(d - dApice < 6,
            `il muro risale di ${(d - dApice).toFixed(1)} a ${off} campioni dall'apice: è una punta, non un raccordo`);
    }
});
