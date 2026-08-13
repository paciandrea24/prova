const test = require('node:test');
const assert = require('node:assert/strict');
const SceneryGaps = require('./sceneryGaps.js');

// Anello di raggio 200, campionato ogni ~3 unità.
function anello(n = 400, r = 200) {
    const pts = [];
    for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        pts.push({ x: Math.cos(a) * r, z: Math.sin(a) * r });
    }
    return pts;
}

test('un giro senza niente è tutto vuoto, su entrambi i lati', () => {
    const pts = anello();
    const tratti = SceneryGaps.trattiVuoti(pts, []);
    const perLato = { 1: 0, '-1': 0 };
    for (const t of tratti) perLato[t.lato] += t.lunghezza;
    const giro = 2 * Math.PI * 200;
    assert.ok(Math.abs(perLato[1] - giro) < giro * 0.02, 'lato destro tutto vuoto');
    assert.ok(Math.abs(perLato['-1'] - giro) < giro * 0.02, 'lato sinistro tutto vuoto');
});

test('una struttura svuota il tratto attorno a sé, solo sul suo lato', () => {
    const pts = anello();
    // A 230 dal centro sul raggio a 0°, cioè appena fuori dall'anello.
    // ⚠️ Su quale dei due lati finisca dipende dal verso di percorrenza e
    // dalla convenzione di `normalAt`: il test non lo assume, guarda solo che
    // UN lato si sia riempito e l'ALTRO no.
    const layout = [{ asset: 'grandStand', category: 'grandstand', x: 230, y: 0, z: 0, rotY: 0 }];
    const tratti = SceneryGaps.trattiVuoti(pts, layout);
    const perLato = [1, -1].map(l =>
        tratti.filter(t => t.lato === l).reduce((s, t) => s + t.lunghezza, 0));
    const pieno = Math.min(...perLato), spoglio = Math.max(...perLato);
    assert.ok(spoglio - pieno >= 100,
        `la struttura deve togliere almeno 100 unità di vuoto al suo lato: `
        + `${pieno.toFixed(0)} contro ${spoglio.toFixed(0)}`);
    const giro = 2 * Math.PI * 200;
    assert.ok(Math.abs(spoglio - giro) < giro * 0.02,
        "l'altro lato deve restare vuoto per intero");
});

test('la vegetazione NON conta come struttura', () => {
    const pts = anello();
    const alberi = [{ asset: 'treeBroad', category: 'nature', x: 230, y: 0, z: 0, rotY: 0 }];
    const conAlberi = SceneryGaps.trattiVuoti(pts, alberi);
    const senzaNiente = SceneryGaps.trattiVuoti(pts, []);
    assert.equal(conAlberi.length, senzaNiente.length,
        'gli alberi non riempiono: il circuito resta spoglio uguale');
});

test('una struttura troppo lontana dalla pista non conta', () => {
    const pts = anello();
    // A 400 dal centro: 200 unità oltre l'asse, ben fuori dalla fascia di 90.
    const lontana = [{ asset: 'grandStand', category: 'grandstand', x: 400, y: 0, z: 0, rotY: 0 }];
    const con = SceneryGaps.trattiVuoti(pts, lontana);
    const senza = SceneryGaps.trattiVuoti(pts, []);
    assert.equal(con.length, senza.length,
        'una struttura oltre la fascia non riempie niente');
});

test('un tratto su viadotto è marcato, così i test possono escluderlo', () => {
    const pts = anello();
    for (let i = 100; i < 160; i++) pts[i].bridge = true;
    const tratti = SceneryGaps.trattiVuoti(pts, []);
    assert.ok(tratti.some(t => t.suViadotto),
        'almeno un tratto deve risultare su viadotto');
});

test('i tratti tornano ordinati dal più lungo', () => {
    const pts = anello();
    const layout = [
        { asset: 'grandStand', category: 'grandstand', x: 230, y: 0, z: 0, rotY: 0 },
        { asset: 'grandStand', category: 'grandstand', x: -230, y: 0, z: 0, rotY: 0 },
    ];
    const tratti = SceneryGaps.trattiVuoti(pts, layout);
    for (let i = 1; i < tratti.length; i++) {
        assert.ok(tratti[i - 1].lunghezza >= tratti[i].lunghezza,
            'la lista deve essere ordinata per lunghezza decrescente');
    }
});
