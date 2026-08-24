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
