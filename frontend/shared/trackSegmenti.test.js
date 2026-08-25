// frontend/shared/trackSegmenti.test.js
//
// ⚠️ Questo file NON gira con `node --test backend/`, il comando abituale del
// progetto: sta in frontend/shared. Serve `node --test frontend/shared/`.
const test = require('node:test');
const assert = require('node:assert/strict');
const TS = require('./trackSegmenti.js');

// Uno "stadio": due rettilinei paralleli uniti da due tornanti. E' la forma
// minima che prova insieme rette, curve e chiusura.
//
// ⚠️ I nodi dei rettilinei hanno la direzione DEL RETTILINEO. Non e' un
// dettaglio del test: e' l'invariante del modello — un tratto retto impone la
// propria direzione ai suoi due nodi, ed e' cio' che tiene insieme la
// tangenza. Una geometria che lo viola (rette con nodi girati altrove)
// descrive uno spigolo, e `cuoci` lo disegna fedelmente: a mantenerla
// coerente e' `raddrizza`, non la cottura.
function stadio() {
    const R = 100;
    const AVANTI = Math.atan2(1, 0);    // verso +x
    const INDIETRO = Math.atan2(-1, 0); // verso -x
    const nodi = [
        { x: -R, z: -R, y: 0, dir: AVANTI },
        { x:  R, z: -R, y: 0, dir: AVANTI },
        { x:  R, z:  R, y: 0, dir: INDIETRO },
        { x: -R, z:  R, y: 0, dir: INDIETRO },
    ];
    return { versione: 1, nodi, tratti: [
        { tipo: 'retta' }, { tipo: 'curva' }, { tipo: 'retta' }, { tipo: 'curva' },
    ] };
}

test('cuoci: una retta produce punti allineati', () => {
    const g = { versione: 1,
        nodi: [
            { x: 0, z: 0, y: 0, dir: Math.atan2(1, 0) },
            { x: 100, z: 0, y: 0, dir: Math.atan2(1, 0) },
            { x: 100, z: 50, y: 0, dir: Math.atan2(0, 1) },
        ],
        tratti: [{ tipo: 'retta' }, { tipo: 'curva' }, { tipo: 'curva' }] };
    const punti = TS.cuoci(g, 5);
    // I punti del PRIMO tratto (fino al nodo 1) devono stare sulla retta z=0.
    const suRetta = punti.filter(p => p.x >= 0 && p.x <= 100 && Math.abs(p.z) < 1e-6);
    assert.ok(suRetta.length >= 19, `attesi almeno 19 punti sulla retta, trovati ${suRetta.length}`);
});

test('cuoci: il passo richiesto viene rispettato', () => {
    const punti = TS.cuoci(stadio(), 5);
    for (let i = 0; i < punti.length; i++) {
        const a = punti[i], b = punti[(i + 1) % punti.length];
        const d = Math.hypot(b.x - a.x, b.z - a.z);
        assert.ok(d <= 5.5, `passo ${d.toFixed(2)} fra i punti ${i} e ${i + 1}, atteso <= 5.5`);
    }
});

test('cuoci: la catena chiude sul primo nodo', () => {
    const g = stadio();
    const punti = TS.cuoci(g, 5);
    const primo = punti[0], ultimo = punti[punti.length - 1];
    assert.ok(Math.hypot(primo.x - g.nodi[0].x, primo.z - g.nodi[0].z) < 1e-6,
        'il primo punto cotto deve essere il primo nodo');
    const chiusura = Math.hypot(ultimo.x - primo.x, ultimo.z - primo.z);
    assert.ok(chiusura > 0 && chiusura <= 5.5, `l'ultimo punto dista ${chiusura.toFixed(2)} dal primo`);
});

test('ogni tratto parte e arriva con la direzione del suo nodo', () => {
    // ⚠️ La tangente si misura sul TRATTO a t→0, non sulla corda fra due
    // punti cotti: una corda di 5 unita' su una curva forma con la tangente
    // un angolo di passo/(2R) — su raggio 133 sono 0.019 rad, e misurandola
    // si boccerebbe una tangenza che invece e' esatta (verificato: lo scarto
    // scende a 1e-6 per t=1e-6, cioe' e' l'errore della corda e non del
    // modello).
    const g = stadio();
    const scartoAngolare = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
    const T = 1e-6;
    for (let i = 0; i < g.nodi.length; i++) {
        const a = g.nodi[i], b = g.nodi[(i + 1) % g.nodi.length];
        const tratto = g.tratti[i];

        const versoUscita = TS.valutaTratto(a, b, tratto, T);
        const dirUscita = Math.atan2(versoUscita.x - a.x, versoUscita.z - a.z);
        assert.ok(scartoAngolare(dirUscita, a.dir) < 1e-4,
            `il tratto ${i} parte a ${scartoAngolare(dirUscita, a.dir).toExponential(1)} rad dalla direzione del nodo`);

        const versoArrivo = TS.valutaTratto(a, b, tratto, 1 - T);
        const dirArrivo = Math.atan2(b.x - versoArrivo.x, b.z - versoArrivo.z);
        assert.ok(scartoAngolare(dirArrivo, b.dir) < 1e-4,
            `il tratto ${i} arriva a ${scartoAngolare(dirArrivo, b.dir).toExponential(1)} rad dalla direzione del nodo`);
    }
});

test('cuoci: quota e ponte si propagano ai punti intermedi', () => {
    const g = {
        versione: 1,
        nodi: [
            { x: 0, z: 0, y: 0, bridge: true, dir: Math.atan2(1, 0) },
            { x: 100, z: 0, y: 10, bridge: true, dir: Math.atan2(1, 0) },
            { x: 100, z: 80, y: 0, bridge: false, dir: Math.atan2(0, 1) },
        ],
        tratti: [{ tipo: 'retta' }, { tipo: 'curva' }, { tipo: 'curva' }],
    };
    const punti = TS.cuoci(g, 5);
    const meta = punti.find(p => Math.abs(p.x - 50) < 3 && Math.abs(p.z) < 1e-6);
    assert.ok(meta, 'deve esistere un punto a meta della prima retta');
    assert.ok(Math.abs(meta.y - 5) < 0.6, `quota interpolata ${meta.y.toFixed(2)}, attesa ~5`);
    assert.equal(meta.bridge, true, 'fra due nodi ponte, il punto e ponte');
    // Il tratto successivo esce dal nodo 1 verso +x e arriva al nodo 2 da +z,
    // quindi si allarga oltre x=100: si cerca per z, non per x.
    const dopo = punti.filter(p => p.z > 20 && p.z < 60);
    assert.ok(dopo.length, 'deve esistere un punto sul tratto successivo');
    assert.ok(dopo.every(p => !p.bridge), 'con un solo nodo ponte, i punti non sono ponte');
});

const TrackGeometry = require('./trackGeometry.js');

// LA MISURA CHE GIUSTIFICA L'IMPIANTO. Fra la forma che l'autore disegna e
// quella che il gioco vede ci sono due passaggi: la cottura in punti fitti e
// la Catmull-Rom di trackLoader. Se il gioco vedesse una forma diversa da
// quella disegnata, tutto il modello non servirebbe a niente — e il difetto
// sarebbe invisibile nell'editor, che mostra la forma giusta.
test('la forma che il GIOCO vede coincide con quella disegnata', () => {
    // Curve strette e rettilinei lunghi: e' dove un passo di cottura troppo
    // largo si vedrebbe per primo.
    const g = { versione: 1, nodi: [
        { x: -200, z: -120, y: 0, dir: Math.atan2(1, 0) },
        { x:  200, z: -120, y: 0, dir: Math.atan2(1, 0) },
        { x:  260, z:  -40, y: 0, dir: Math.atan2(0, 1) },
        { x:  120, z:   90, y: 0, dir: Math.atan2(-1, 0.2) },
        { x: -160, z:  110, y: 0, dir: Math.atan2(-1, -0.4) },
    ], tratti: [
        { tipo: 'retta' }, { tipo: 'curva' }, { tipo: 'curva' },
        { tipo: 'curva' }, { tipo: 'curva' },
    ] };

    const cotti = TS.cuoci(g, TS.PASSO_COTTURA);
    // Esattamente cio' che fa il gioco: backend/sockets/games/trackLoader.js
    const visti = TrackGeometry.sampleLoop(cotti, 1000);

    // ⚠️ La distanza si misura dalla CURVA, non dal campione piu' vicino: un
    // punto che cade esattamente a meta' fra due campioni a 5 unita' dista
    // 2.5 dal piu' vicino pur stando perfettamente sulla curva. Misurandolo
    // cosi' si bocciava una cottura corretta con «2.501 di scostamento»,
    // cioe' meta' del passo.
    //
    // Il riferimento e' la stessa geometria cotta fittissima (1 unita'), e la
    // distanza e' dal SEGMENTO fra due riferimenti consecutivi: cosi' il bias
    // residuo del campionamento e' 1/(8R), sotto il millesimo di unita'.
    const riferimento = TS.cuoci(g, 1);
    function distanzaDalSegmento(p, a, b) {
        const vx = b.x - a.x, vz = b.z - a.z;
        const L = vx * vx + vz * vz;
        let t = L > 0 ? ((p.x - a.x) * vx + (p.z - a.z) * vz) / L : 0;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(p.x - (a.x + vx * t), p.z - (a.z + vz * t));
    }

    let peggio = 0;
    for (const v of visti) {
        let minimo = Infinity;
        for (let i = 0; i < riferimento.length; i++) {
            const d = distanzaDalSegmento(v, riferimento[i], riferimento[(i + 1) % riferimento.length]);
            if (d < minimo) minimo = d;
        }
        if (minimo > peggio) peggio = minimo;
    }
    assert.ok(peggio < 0.2,
        `il gioco vede una forma scostata di ${peggio.toFixed(3)} unita da quella disegnata, tetto 0.2`);
});

// --- Misure e operazioni --------------------------------------------------

function treNodi() {
    return { versione: 1, nodi: [
        { x: 0, z: 0, y: 0, dir: Math.atan2(1, 0) },
        { x: 100, z: 0, y: 0, dir: Math.atan2(1, 0) },
        { x: 100, z: 90, y: 0, dir: Math.atan2(0, 1) },
    ], tratti: [{ tipo: 'retta' }, { tipo: 'curva' }, { tipo: 'curva' }] };
}

test('misureTratto: una retta ha la lunghezza della corda e raggio infinito', () => {
    const m = TS.misureTratto(treNodi(), 0);
    assert.ok(Math.abs(m.lunghezza - 100) < 0.01, `lunghezza ${m.lunghezza}`);
    assert.equal(m.raggioMinimo, Infinity);
    assert.ok(Math.abs(m.angolo) < 1e-9, 'una retta non gira');
});

test('misureTratto: una curva a gomito ha angolo 90 gradi e raggio finito', () => {
    const g = { versione: 1, nodi: [
        { x: 0, z: 0, y: 0, dir: Math.atan2(1, 0) },
        { x: 100, z: 0, y: 0, dir: Math.atan2(1, 0) },
        { x: 200, z: 100, y: 0, dir: Math.atan2(0, 1) },
    ], tratti: [{ tipo: 'retta' }, { tipo: 'curva' }, { tipo: 'curva' }] };
    const m = TS.misureTratto(g, 1);
    assert.ok(Math.abs(Math.abs(m.angolo) - Math.PI / 2) < 0.01, `angolo ${m.angolo}`);
    assert.ok(m.raggioMinimo > 10 && m.raggioMinimo < 200, `raggio minimo ${m.raggioMinimo}`);
});

test('raddrizza: allinea le tangenti dei due nodi del tratto', () => {
    const g = { versione: 1, nodi: [
        { x: 0, z: 0, y: 0, dir: 1.2 },
        { x: 100, z: 0, y: 0, dir: -0.4 },
        { x: 100, z: 90, y: 0, dir: Math.atan2(0, 1) },
    ], tratti: [{ tipo: 'curva' }, { tipo: 'curva' }, { tipo: 'curva' }] };
    const dopo = TS.raddrizza(g, 0);
    const atteso = Math.atan2(100, 0);
    assert.equal(dopo.tratti[0].tipo, 'retta');
    assert.ok(Math.abs(dopo.nodi[0].dir - atteso) < 1e-9);
    assert.ok(Math.abs(dopo.nodi[1].dir - atteso) < 1e-9);
    assert.equal(g.nodi[0].dir, 1.2, 'la geometria di partenza non va mutata');
});

test('raddrizza: un tratto retto adiacente che perde l allineamento diventa curva', () => {
    // Due rette ad angolo retto: il nodo in mezzo non puo' avere due direzioni.
    const g = { versione: 1, nodi: [
        { x: 0, z: 0, y: 0, dir: Math.atan2(1, 0) },
        { x: 100, z: 0, y: 0, dir: Math.atan2(1, 0) },
        { x: 100, z: 100, y: 0, dir: Math.atan2(0, 1) },
        { x: 0, z: 100, y: 0, dir: Math.atan2(-1, 0) },
    ], tratti: [{ tipo: 'retta' }, { tipo: 'retta' }, { tipo: 'curva' }, { tipo: 'curva' }] };
    const dopo = TS.raddrizza(g, 0);
    assert.equal(dopo.tratti[0].tipo, 'retta');
    assert.equal(dopo.tratti[1].tipo, 'curva', 'il tratto adiacente non allineato cede');
});

test('raddrizza: un tratto retto adiacente GIA allineato resta retto', () => {
    // Tre nodi in fila sulla stessa retta: raddrizzare il primo tratto non
    // deve incurvare il secondo, che e' gia' nella stessa direzione.
    const g = { versione: 1, nodi: [
        { x: 0, z: 0, y: 0, dir: 0.3 },
        { x: 100, z: 0, y: 0, dir: 0.3 },
        { x: 200, z: 0, y: 0, dir: Math.atan2(1, 0) },
        { x: 100, z: 150, y: 0, dir: Math.atan2(-1, 0) },
    ], tratti: [{ tipo: 'retta' }, { tipo: 'retta' }, { tipo: 'curva' }, { tipo: 'curva' }] };
    const dopo = TS.raddrizza(g, 0);
    assert.equal(dopo.tratti[1].tipo, 'retta', 'gia allineato: non deve cedere');
});

test('impostaLunghezza: sposta il nodo di arrivo e nessun altro', () => {
    const dopo = TS.impostaLunghezza(treNodi(), 0, 140);
    assert.ok(Math.abs(dopo.nodi[1].x - 140) < 0.01, `nodo di arrivo a x=${dopo.nodi[1].x}`);
    assert.equal(dopo.nodi[0].x, 0, 'il nodo di partenza non si muove');
    assert.equal(dopo.nodi[2].x, 100, 'i nodi successivi non si muovono');
});

test('direzioneAutomatica: un nodo segue i suoi vicini', () => {
    const g = { versione: 1, nodi: [
        { x: -100, z: 0, y: 0, dir: 0 },
        { x: 0, z: 0, y: 0, dir: 0 },
        { x: 100, z: 0, y: 0, dir: 0 },
    ], tratti: [{ tipo: 'curva' }, { tipo: 'curva' }, { tipo: 'curva' }] };
    assert.ok(Math.abs(TS.direzioneAutomatica(g, 1) - Math.atan2(1, 0)) < 1e-9);
});

// --- riallinea: la catena resta coerente quando un nodo si muove ----------

// Quanto si scosta dalla retta il PRIMO tratto. Solo i suoi punti: cuoci
// scorre i tratti in ordine, quindi sono i primi. Filtrare per proiezione sul
// segmento prenderebbe anche il tratto opposto del circuito, che in proiezione
// ci cade dentro — ed e' l'errore che faceva leggere «430 unita fuori» su una
// retta perfetta.
function scartoDalPrimoTratto(g) {
    const punti = TS.cuoci(g, TS.PASSO_COTTURA);
    const a = g.nodi[0], b = g.nodi[1];
    const quanti = Math.round(TS.misureTratto(g, 0).lunghezza / TS.PASSO_COTTURA);
    let peggio = 0;
    for (let i = 0; i <= quanti && i < punti.length; i++) {
        const p = punti[i];
        const vx = b.x - a.x, vz = b.z - a.z, L = vx * vx + vz * vz;
        let t = L > 0 ? ((p.x - a.x) * vx + (p.z - a.z) * vz) / L : 0;
        t = Math.max(0, Math.min(1, t));
        peggio = Math.max(peggio, Math.hypot(p.x - (a.x + vx * t), p.z - (a.z + vz * t)));
    }
    return peggio;
}

function cinqueNodi() {
    const g = { versione: 1, nodi: [], tratti: [] };
    for (const [x, z] of [[-300, -150], [300, -150], [420, 40], [100, 240], [-350, 80]]) {
        g.nodi.push({ x, z, y: 0, dir: 0 });
        g.tratti.push({ tipo: 'curva' });
    }
    return TS.riallinea(g);
}

test('una retta dichiarata resta dritta quando si sposta un altro nodo', () => {
    // Il difetto che questo test impedisce: un tratto marcato «retta» e
    // disegnato curvo perche' i suoi nodi hanno preso la direzione dei vicini.
    let g = TS.raddrizza(cinqueNodi(), 0);
    g.nodi[0].dirManuale = true;
    g.nodi[1].dirManuale = true;
    assert.ok(scartoDalPrimoTratto(g) < 1e-6, 'appena dichiarata deve essere dritta');

    g.nodi[3].x = 60; g.nodi[3].z = 300;       // un nodo lontano
    g = TS.riallinea(g);
    assert.ok(scartoDalPrimoTratto(g) < 1e-6, 'un nodo lontano non deve incurvarla');

    g.nodi[2].x = 500; g.nodi[2].z = 100;      // il nodo adiacente
    g = TS.riallinea(g);
    assert.ok(scartoDalPrimoTratto(g) < 1e-6, 'il nodo adiacente non deve incurvarla');

    g.nodi[1].x = 260; g.nodi[1].z = -120;     // un ESTREMO della retta
    g = TS.riallinea(g);
    assert.equal(g.tratti[0].tipo, 'retta');
    assert.ok(scartoDalPrimoTratto(g) < 1e-6, 'spostare un estremo la sposta, non la incurva');
});

test('riallinea: una direzione scelta a mano non viene sovrascritta', () => {
    const g = cinqueNodi();
    g.nodi[2].dir = 1.234;
    g.nodi[2].dirManuale = true;
    const dopo = TS.riallinea(g);
    assert.equal(dopo.nodi[2].dir, 1.234, 'dirManuale e la memoria di una scelta');
    // e un nodo senza quel segno invece segue i vicini
    assert.ok(Math.abs(dopo.nodi[3].dir - TS.direzioneAutomatica(dopo, 3)) < 1e-9);
});

test('riallinea: non muta la geometria ricevuta', () => {
    const g = cinqueNodi();
    const primaX = g.nodi[0].x, primaDir = g.nodi[0].dir;
    const dopo = TS.riallinea(TS.raddrizza(g, 0));
    assert.equal(g.nodi[0].x, primaX);
    assert.equal(g.nodi[0].dir, primaDir);
    assert.notEqual(dopo, g);
});

// --- inserisci: un nodo IN MEZZO a un tratto ------------------------------

test('inserisci: il nodo nuovo cade sul tratto, e la catena resta coerente', () => {
    const g = cinqueNodi();
    const primaNodi = g.nodi.length;
    const puntiPrima = TS.cuoci(g, 1);

    const dopo = TS.inserisci(g, 1);   // spezza il tratto 1
    assert.equal(dopo.nodi.length, primaNodi + 1);
    assert.equal(dopo.tratti.length, primaNodi + 1, 'un tratto per ogni nodo, sempre');

    // Il nodo nuovo sta a meta' del tratto vecchio: deve trovarsi SULLA forma
    // di prima, non da qualche altra parte.
    const nuovo = dopo.nodi[2];
    let distanza = Infinity;
    for (const p of puntiPrima) {
        distanza = Math.min(distanza, Math.hypot(p.x - nuovo.x, p.z - nuovo.z));
    }
    assert.ok(distanza < 1, `il nodo nuovo dista ${distanza.toFixed(2)} dalla curva di prima`);
});

test('inserisci: spezzare una retta lascia due rette', () => {
    let g = TS.raddrizza(cinqueNodi(), 0);
    g.nodi[0].dirManuale = true;
    g.nodi[1].dirManuale = true;
    const dopo = TS.inserisci(g, 0);
    assert.equal(dopo.tratti[0].tipo, 'retta', 'la prima meta resta retta');
    assert.equal(dopo.tratti[1].tipo, 'retta', 'e anche la seconda');
    // e il rettilineo non si e' incurvato: i tre nodi sono allineati
    const [a, b, c] = [dopo.nodi[0], dopo.nodi[1], dopo.nodi[2]];
    const area2 = Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z));
    assert.ok(area2 < 1e-6, `i tre nodi non sono allineati (area ${area2})`);
});

test('inserisci: spezzare una curva non ne cambia la forma', () => {
    const g = cinqueNodi();
    const prima = TS.cuoci(g, 1);
    const dopo = TS.cuoci(TS.inserisci(g, 2), 1);
    // Ogni punto della curva nuova deve stare su quella vecchia: spezzare e'
    // un'operazione che aggiunge un appiglio, non che ridisegna.
    let peggio = 0;
    for (const p of dopo) {
        let minimo = Infinity;
        for (const q of prima) minimo = Math.min(minimo, Math.hypot(p.x - q.x, p.z - q.z));
        peggio = Math.max(peggio, minimo);
    }
    assert.ok(peggio < 2, `la forma si e spostata di ${peggio.toFixed(2)} unita`);
});

// ---- spostare un tratto intero ----
//
// «Sposta segmenti aggregati» della carrellata del 2026-08-23: prendere un
// rettilineo e spostarlo di lato senza trascinarne i capi uno per volta.
// ⚠️ Tolleranza al centesimo e non 1e-6: le coordinate si arrotondano a due
// decimali, come fa il trascinamento dei nodi in tutto l'editor. Su un anello
// di prova con coordinate irrazionali (sin/cos per 200) l'arrotondamento vale
// fino a mezzo centesimo per capo.
const CENTESIMO = 0.011;

function anelloDiProva() {
    const R = 200, nodi = [], tratti = [];
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        nodi.push({ x: Math.sin(a) * R, z: Math.cos(a) * R, y: 0, dir: 0 });
        tratti.push({ tipo: 'curva' });
    }
    return TS.riallinea({ versione: 1, nodi, tratti });
}

test('trattoVicinoA trova il tratto sotto un punto del nastro', () => {
    const g = anelloDiProva();
    // Un punto preso a meta' del primo tratto: deve tornare proprio quello.
    const meta = TS.valutaTratto(g.nodi[0], g.nodi[1], g.tratti[0], 0.5);
    const trovato = TS.trattoVicinoA(g, meta.x, meta.z, 12);
    assert.ok(trovato, 'nessun tratto trovato dove passa la pista');
    assert.equal(trovato.indice, 0);
});

test('trattoVicinoA non trova niente lontano dalla pista', () => {
    const g = anelloDiProva();
    // In mezzo all'anello: li' la pista non passa, e cliccare deve continuare
    // ad aggiungere un nodo invece di afferrare un tratto a caso.
    assert.equal(TS.trattoVicinoA(g, 0, 0, 12), null);
    assert.equal(TS.trattoVicinoA(g, 9000, 9000, 12), null);
});

test('spostaTratto muove i due capi della STESSA quantita\'', () => {
    const g = anelloDiProva();
    const a0 = { x: g.nodi[2].x, z: g.nodi[2].z };
    const b0 = { x: g.nodi[3].x, z: g.nodi[3].z };
    const dopo = TS.spostaTratto(g, 2, 10, -4);
    assert.ok(Math.abs(dopo.nodi[2].x - (a0.x + 10)) < CENTESIMO);
    assert.ok(Math.abs(dopo.nodi[2].z - (a0.z - 4)) < CENTESIMO);
    assert.ok(Math.abs(dopo.nodi[3].x - (b0.x + 10)) < CENTESIMO);
    assert.ok(Math.abs(dopo.nodi[3].z - (b0.z - 4)) < CENTESIMO);
    // E si muovono della STESSA quantita': e' il punto del tratto aggregato.
    assert.ok(Math.abs((dopo.nodi[2].x - a0.x) - (dopo.nodi[3].x - b0.x)) < CENTESIMO);
    // Gli altri nodi non si muovono: e' un TRATTO che si sposta, non la pista.
    assert.equal(dopo.nodi[0].x, g.nodi[0].x);
    assert.equal(dopo.nodi[5].z, g.nodi[5].z);
    // E la geometria di partenza non si tocca: annulla/rifai conta su questo.
    assert.equal(g.nodi[2].x, a0.x);
});

test('spostare un tratto non ne gira le direzioni', () => {
    // Muovere un rettilineo di lato non deve ruotarlo: se le direzioni si
    // riallineassero, il tratto girerebbe a ogni pixel di trascinamento.
    const g = anelloDiProva();
    const dirPrima = g.nodi.map(n => n.dir);
    const dopo = TS.spostaTratto(g, 1, 25, 25);
    assert.deepEqual(dopo.nodi.map(n => n.dir), dirPrima);
});

test('spostare l\'ultimo tratto prende anche il nodo zero', () => {
    // Il giro e' chiuso: l'ultimo tratto va dall'ultimo nodo al primo.
    const g = anelloDiProva();
    const ultimo = g.nodi.length - 1;
    const x0 = g.nodi[0].x;
    const dopo = TS.spostaTratto(g, ultimo, 7, 0);
    assert.ok(Math.abs(dopo.nodi[0].x - (x0 + 7)) < CENTESIMO, 'il nodo 0 doveva muoversi');
    assert.ok(Math.abs(dopo.nodi[ultimo].x - (g.nodi[ultimo].x + 7)) < CENTESIMO);
});

// ---- larghezza variabile per tratto ----
//
// Blocco D. La mezza carreggiata viaggia SUL PUNTO, come la quota: un secondo
// array parallelo ai punti sarebbe una cosa in piu' che puo' disallinearsi.
test('senza larghezza nominale i punti restano come prima', () => {
    // Le piste disegnate prima di questa feature non devono cambiare di un
    // campo: e' la condizione per non ricuocere niente.
    const g = anelloDiProva();
    for (const p of TS.cuoci(g, TS.PASSO_COTTURA)) {
        assert.equal(p.halfWidth, undefined);
    }
});

test('ogni punto porta la larghezza del suo tratto', () => {
    const g = anelloDiProva();
    g.tratti[2] = { tipo: 'curva', larghezza: 20 };
    const punti = TS.cuoci(g, TS.PASSO_COTTURA, 11);
    const larghezze = new Set(punti.map(p => p.halfWidth));
    assert.deepEqual([...larghezze].sort((a, b) => a - b), [11, 20],
        'devono esserci solo la nominale e quella del tratto largo');
    assert.ok(punti.some(p => p.halfWidth === 20), 'il tratto largo non ha lasciato traccia');
});

test('un tratto senza larghezza propria prende la nominale', () => {
    const g = anelloDiProva();
    for (const p of TS.cuoci(g, TS.PASSO_COTTURA, 11)) assert.equal(p.halfWidth, 11);
});

test('una larghezza non valida non passa: si ricade sulla nominale', () => {
    // Zero e i negativi non sono una carreggiata, e un NaN si propagherebbe
    // in silenzio fino alla fisica.
    const g = anelloDiProva();
    for (const cattiva of [0, -5, NaN, null, 'venti']) {
        g.tratti[1] = { tipo: 'curva', larghezza: cattiva };
        const punti = TS.cuoci(g, TS.PASSO_COTTURA, 11);
        assert.ok(punti.every(p => p.halfWidth === 11),
            `larghezza ${cattiva} non doveva passare`);
    }
});

// ---- sopraelevazione per tratto (fase 1b-1: banking) ----
//
// Stessa strada della larghezza: il campo nasce sul TRATTO, viaggia sul PUNTO,
// e dice solo QUANTO ci si alza. Quale bordo salga lo decide la curva, molto
// piu' a valle (TrackGeometry.rialzoBordi), perche' e' una proprieta' della
// geometria e non dell'intenzione dell'autore.
test('una pista senza sopraelevazioni non guadagna il campo', () => {
    const g = anelloDiProva();
    for (const p of TS.cuoci(g, TS.PASSO_COTTURA, 11)) {
        assert.equal(p.rollio, undefined);
    }
});

test('il rollio di un tratto arriva sui suoi punti, in radianti', () => {
    const g = anelloDiProva();
    g.tratti[2] = { tipo: 'curva', rollioGradi: 18 };
    const punti = TS.cuoci(g, TS.PASSO_COTTURA, 11);
    const atteso = 18 * Math.PI / 180;
    const max = Math.max(...punti.map(p => p.rollio));
    assert.ok(Math.abs(max - atteso) < 1e-12,
        `il tratto sopraelevato tocca ${(max * 180 / Math.PI).toFixed(1)}° invece di 18°`);
    // Gli altri tratti restano piani, col campo esplicito a zero: un campo
    // assente accanto a uno pieno farebbe interpolare l'evalSegment su una
    // sola sponda, e il raccordo direbbe una cosa inventata.
    assert.ok(punti.some(p => p.rollio === 0), 'i tratti piani devono avere rollio 0');
});

test('la sopraelevazione entra e esce gradualmente, non a scalino', () => {
    // ⚠️ Senza raccordo il rollio salta dal valore di un tratto a quello del
    // vicino in un passo di cottura: misurati 8.8 gradi fra due campioni, cioe'
    // 18 gradi in tre metri di pista. L'auto si coricherebbe di colpo.
    const g = anelloDiProva();
    g.tratti[2] = { tipo: 'curva', rollioGradi: 18 };
    const punti = TS.cuoci(g, TS.PASSO_COTTURA, 11);
    // ⚠️ La misura e' in gradi per UNITA' DI PISTA, non per campione: una
    // soglia per campione varrebbe cose diverse su ogni pista, a seconda del
    // passo di cottura.
    let salto = 0;
    for (let i = 0; i < punti.length; i++) {
        const prec = punti[(i - 1 + punti.length) % punti.length];
        salto = Math.max(salto, Math.abs(punti[i].rollio - prec.rollio));
    }
    const gradiPerUnita = (salto * 180 / Math.PI) / TS.PASSO_COTTURA;
    assert.ok(gradiPerUnita < 0.5,
        `il rollio cambia di ${gradiPerUnita.toFixed(2)}° per unita' di pista: e' uno scalino`);

    // E la transizione dura davvero, invece di essere un gradino ammorbidito.
    const inTransizione = punti.filter(p => p.rollio > 1e-9 && p.rollio < 18 * Math.PI / 180 - 1e-9).length;
    const unitaDiTransizione = inTransizione * TS.PASSO_COTTURA;
    assert.ok(unitaDiTransizione > TS.RACCORDO_ROLLIO,
        `la transizione totale dura ${unitaDiTransizione} unita', attese piu' di ${TS.RACCORDO_ROLLIO}`);
});

test('il rollio non supera ROLLIO_MAX', () => {
    const g = anelloDiProva();
    g.tratti[1] = { tipo: 'curva', rollioGradi: 80 };
    const punti = TS.cuoci(g, TS.PASSO_COTTURA, 11);
    const max = Math.max(...punti.map(p => p.rollio || 0));
    assert.ok(max <= TS.ROLLIO_MAX + 1e-12, `${max} oltre il massimo ${TS.ROLLIO_MAX}`);
    assert.ok(Math.abs(max - TS.ROLLIO_MAX) < 1e-12, 'ottanta gradi devono saturare al massimo');
});

test('una sopraelevazione non valida vale piano, mai NaN', () => {
    // Se nessun tratto e' sopraelevato il campo non compare affatto (la pista
    // resta quella di prima), quindi il valore buono e' `undefined` oppure 0 —
    // ma mai NaN, che si propagherebbe fino alla mesh e alla tenuta in curva.
    const g = anelloDiProva();
    for (const cattiva of [-5, NaN, null, 'venti', Infinity]) {
        g.tratti[1] = { tipo: 'curva', rollioGradi: cattiva };
        const punti = TS.cuoci(g, TS.PASSO_COTTURA, 11);
        assert.ok(punti.every(p => p.rollio === undefined || p.rollio === 0),
            `sopraelevazione ${cattiva} non doveva passare`);
    }
});

test('un valore assurdo accanto a uno buono vale zero, non contagia il vicino', () => {
    // Qui il campo c'e' per forza (un tratto e' davvero sopraelevato): il
    // tratto malformato deve valere ZERO, e soprattutto non deve prendersi il
    // rollio del vicino ne' diventare NaN.
    const g = anelloDiProva();
    g.tratti[2] = { tipo: 'curva', rollioGradi: 18 };
    for (const cattiva of [-5, NaN, null, 'venti', Infinity]) {
        g.tratti[1] = { tipo: 'curva', rollioGradi: cattiva };
        const punti = TS.cuoci(g, TS.PASSO_COTTURA, 11);
        assert.ok(punti.every(p => Number.isFinite(p.rollio)), `${cattiva}: rollio non finito`);
        // Col raccordo esistono anche i valori intermedi della transizione: il
        // punto e' che nessuno esca dall'intervallo fra piano e il tratto
        // sopraelevato — cioe' il tratto malformato non si prende il rollio del
        // vicino ne' inventa un valore suo.
        const max = 18 * Math.PI / 180;
        assert.ok(punti.every(p => p.rollio >= 0 && p.rollio <= max + 1e-12),
            `${cattiva}: qualche punto e' fuori dall'intervallo [0, 18°]`);
        assert.ok(Math.abs(Math.max(...punti.map(p => p.rollio)) - max) < 1e-12,
            `${cattiva}: il tratto buono non tocca piu' i suoi 18°`);
        assert.ok(punti.some(p => p.rollio === 0), `${cattiva}: nessun punto e' rimasto piano`);
    }
});

// ---- la quota lungo un tratto ----
//
// La linea che l'editor disegna sopra l'asfalto deve stare alla quota
// dell'asfalto. La prima versione usava la quota del PRIMO nodo per tutta la
// linea, e su un tratto in salita finiva sotto la pista - segnalato al
// playtest del 2026-08-25. Il punto e' che la quota si interpola sulla
// LUNGHEZZA D'ARCO, e quella formula deve stare in un posto solo.
test('campionaTratto porta la quota, interpolata lungo il tratto', () => {
    const a = { x: 0, z: 0, y: 0, dir: 0 };
    const b = { x: 0, z: 200, y: 10, dir: 0 };
    const punti = TS.campionaTratto(a, b, { tipo: 'retta' }, 5);
    assert.ok(punti.length > 10, 'troppo pochi campioni per giudicare');
    assert.ok(Math.abs(punti[0].y - 0) < 1e-6, 'il primo campione parte dalla quota di a');
    // Sale, e non a scatti: ogni campione non e' piu' basso del precedente.
    for (let i = 1; i < punti.length; i++) {
        assert.ok(punti[i].y >= punti[i - 1].y - 1e-9,
            `il campione ${i} scende: ${punti[i - 1].y} -> ${punti[i].y}`);
    }
    // A meta' del rettilineo la quota e' a meta' del dislivello.
    const meta = punti[Math.floor(punti.length / 2)];
    assert.ok(Math.abs(meta.y - 5) < 0.4, `a meta' la quota e' ${meta.y}, attesa ~5`);
    // E l'ultimo campione NON e' il nodo di arrivo: lo mette il tratto dopo.
    assert.ok(punti[punti.length - 1].y < 10, 'l\'ultimo campione non deve essere il nodo b');
});

// ⚠️ VISTO IN GIOCO il 2026-08-25 (secondo playtest): su una curva a 35 gradi
// costruita con UN SOLO tratto, il rollio saliva piano fino a 20.8° e poi
// saltava a 35° in un campione — quattordici gradi in cinque unita' di pista.
// Il cordolo si impennava, e chi guidava vedeva uno scalino in cima alla
// parabolica.
//
// La causa: il raccordo si spalma su 80 unita', quaranta per lato del confine.
// Su un tratto piu' corto di ottanta le due finestre — quella d'ingresso e
// quella d'uscita — si sovrappongono, e l'ultima scritta cancella meta' della
// prima. Un tratto corto puo' benissimo non arrivare al valore dichiarato (in
// venti metri non si costruisce una parabolica di 35 gradi), ma non deve MAI
// arrivarci di scatto.
function anelloConTrattoCorto(gradi) {
    // Otto nodi su un anello largo — tratti da ~157 unita' — ma il nodo 3
    // portato vicino al 2: il tratto 2 diventa corto (~40 unita'), i suoi
    // vicini restano lunghi. E' la situazione vera: una curva sopraelevata
    // disegnata con UN tratto solo, fra due tratti lunghi.
    const R = 200, nodi = [], tratti = [];
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        nodi.push({ x: Math.sin(a) * R, z: Math.cos(a) * R, y: 0, dir: 0 });
        tratti.push({ tipo: 'curva' });
    }
    const a3 = (2 / 8) * Math.PI * 2 + 0.2;
    nodi[3] = { x: Math.sin(a3) * R, z: Math.cos(a3) * R, y: 0, dir: 0 };
    tratti[2] = { tipo: 'curva', rollioGradi: gradi };
    return TS.riallinea({ versione: 1, nodi, tratti });
}

test("un tratto sopraelevato piu' corto del raccordo non fa scalini", () => {
    const punti = TS.cuoci(anelloConTrattoCorto(35), TS.PASSO_COTTURA, 11);
    let salto = 0, dove = -1;
    for (let i = 0; i < punti.length; i++) {
        const prec = punti[(i - 1 + punti.length) % punti.length];
        const d = Math.abs(punti[i].rollio - prec.rollio);
        if (d > salto) { salto = d; dove = i; }
    }
    const gradiPerUnita = (salto * 180 / Math.PI) / TS.PASSO_COTTURA;
    assert.ok(gradiPerUnita < 0.9,
        `campione ${dove}: il rollio cambia di ${gradiPerUnita.toFixed(2)} gradi per unita' di pista, e' uno scalino`);
});

test("su un tratto corto la sopraelevazione si accontenta, invece di scattare", () => {
    // Puo' anche non arrivare ai 35 gradi dichiarati — in quaranta metri non si
    // costruisce una parabolica intera — ma quello che c'e' dev'essere una
    // salita continua, non un gradino ammorbidito.
    const punti = TS.cuoci(anelloConTrattoCorto(35), TS.PASSO_COTTURA, 11);
    const max = Math.max(...punti.map(p => p.rollio || 0)) * 180 / Math.PI;
    assert.ok(max > 20, `il tratto arriva solo a ${max.toFixed(1)} gradi: il raccordo se l'e' mangiato tutto`);
    assert.ok(max <= 35 + 1e-9, `${max.toFixed(1)} gradi, oltre i 35 dichiarati`);
});
