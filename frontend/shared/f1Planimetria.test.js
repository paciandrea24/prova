// frontend/shared/f1Planimetria.test.js
//
// La mappa di un circuito disegnata in un riquadro. Le due cose che si possono
// sbagliare in silenzio sono l'inquadratura (una pista che esce dal riquadro o
// ci nuota dentro) e le proporzioni (un ovale che diventa un cerchio), ed è
// esattamente quello che questi test guardano.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('./f1Planimetria');

// Un contesto 2D finto: registra le chiamate invece di disegnare.
function ctxFinto() {
    const tratti = [];
    return {
        tratti,
        _corrente: null,
        beginPath() { this._corrente = { punti: [], chiuso: false }; tratti.push(this._corrente); },
        moveTo(x, y) { if (this._corrente) this._corrente.punti.push([x, y]); },
        lineTo(x, y) { if (this._corrente) this._corrente.punti.push([x, y]); },
        closePath() { if (this._corrente) this._corrente.chiuso = true; },
        stroke() {}, fill() {}, clearRect() {}, save() {}, restore() {},
        set lineWidth(v) { this._lineWidth = v; },
        get lineWidth() { return this._lineWidth; },
    };
}

const QUADRATO = [
    { x: 0, z: 0 }, { x: 100, z: 0 }, { x: 100, z: 100 }, { x: 0, z: 100 },
];

test('la pista sta tutta dentro il riquadro, margini compresi', () => {
    const q = P.inquadra(QUADRATO, 400, 300, 20);
    for (const p of QUADRATO) {
        const x = q.offsetX + p.x * q.scala;
        const y = q.offsetY + p.z * q.scala;
        assert.ok(x >= 20 - 0.001 && x <= 380 + 0.001, `x fuori dal riquadro: ${x}`);
        assert.ok(y >= 20 - 0.001 && y <= 280 + 0.001, `y fuori dal riquadro: ${y}`);
    }
});

test('le proporzioni non si deformano: una scala sola per le due direzioni', () => {
    // Un ovale lungo il doppio di quanto e alto deve restare lungo il doppio.
    const ovale = [{ x: 0, z: 0 }, { x: 200, z: 0 }, { x: 200, z: 100 }, { x: 0, z: 100 }];
    const q = P.inquadra(ovale, 400, 400, 10);
    const largo = (q.offsetX + 200 * q.scala) - (q.offsetX + 0 * q.scala);
    const alto = (q.offsetY + 100 * q.scala) - (q.offsetY + 0 * q.scala);
    assert.ok(Math.abs(largo / alto - 2) < 0.001, `rapporto ${largo / alto} invece di 2`);
});

test('quello che avanza si divide in due: la pista resta centrata', () => {
    // Tracciato largo e basso in un riquadro quadrato: sopra e sotto deve
    // restare la stessa aria, o la mappa sembra incollata a un bordo.
    const basso = [{ x: 0, z: 0 }, { x: 300, z: 0 }, { x: 300, z: 50 }, { x: 0, z: 50 }];
    const q = P.inquadra(basso, 400, 400, 0);
    const sopra = q.offsetY + 0 * q.scala;
    const sotto = 400 - (q.offsetY + 50 * q.scala);
    assert.ok(Math.abs(sopra - sotto) < 0.001, `${sopra} sopra contro ${sotto} sotto`);
});

test('un tracciato degenere non fa esplodere la scala', () => {
    // Tutti i punti nello stesso posto: senza una difesa, la scala e' una
    // divisione per zero e la mappa diventa NaN.
    const q = P.inquadra([{ x: 5, z: 5 }, { x: 5, z: 5 }], 200, 200, 10);
    assert.ok(Number.isFinite(q.scala) && q.scala > 0);
    assert.ok(Number.isFinite(q.offsetX) && Number.isFinite(q.offsetY));
    assert.deepEqual(P.inquadra([], 200, 200, 10).scala > 0, true);
});

test('disegna un anello chiuso, e il traguardo a parte', () => {
    const ctx = ctxFinto();
    P.disegna(ctx, QUADRATO, { larghezza: 400, altezza: 300, margine: 20, traguardo: 0 });
    assert.ok(ctx.tratti.length >= 1, 'non ha disegnato niente');
    const anello = ctx.tratti[0];
    assert.equal(anello.punti.length, QUADRATO.length, 'un punto per campione del tracciato');
    assert.equal(anello.chiuso, true, 'il giro non e chiuso: si vedrebbe un taglio sul traguardo');
    // Il traguardo e' un secondo tratto: deve esistere ed essere corto.
    assert.ok(ctx.tratti.length >= 2, 'manca il tratto del traguardo');
});

test('senza traguardo si disegna solo la pista', () => {
    const ctx = ctxFinto();
    P.disegna(ctx, QUADRATO, { larghezza: 400, altezza: 300, margine: 20, traguardo: null });
    assert.equal(ctx.tratti.length, 1);
});
