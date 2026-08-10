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

test('la ghiaia esiste solo in curva e solo sul lato esterno', () => {
    const pts = ovale();
    const prof = TrackGravel.gravelProfile(pts, { roadHalf: 11 });
    const curve = TrackGeometry.findCorners(pts);
    assert.ok(curve.length > 0, 'il caso di prova deve avere curve');

    // Al centro di ogni curva: ghiaia piena sull'esterno, zero sull'interno.
    for (const c of curve) {
        assert.equal(TrackGravel.gravelAt(prof, c.midIdx, c.side),
            TrackGravel.GRAVEL_WIDTH, 'ghiaia piena sul lato esterno');
        assert.equal(TrackGravel.gravelAt(prof, c.midIdx, -c.side), 0,
            'niente ghiaia sul lato interno');
    }

    // Al centro del primo rettilineo (indice 50): niente ghiaia da nessun lato.
    assert.equal(TrackGravel.gravelAt(prof, 50, 1), 0);
    assert.equal(TrackGravel.gravelAt(prof, 50, -1), 0);
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

test('barrierDistAt somma la ghiaia alla distanza base', () => {
    const pts = ovale();
    const prof = TrackGravel.gravelProfile(pts, { roadHalf: 11 });
    const c = TrackGeometry.findCorners(pts)[0];
    const base = 15;
    assert.equal(TrackGravel.barrierDistAt(prof, 50, 1, base), base,
        'sul rettilineo la barriera resta dov\'è oggi');
    assert.equal(TrackGravel.barrierDistAt(prof, c.midIdx, c.side, base),
        base + TrackGravel.GRAVEL_WIDTH);
});
