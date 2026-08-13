const test = require('node:test');
const assert = require('node:assert');
const Forma = require('./barrieraForma.js');

// Cerchio di raggio R campionato fitto: la geometria in cui la risposta
// giusta si sa a mente. Un muro sul lato interno a distanza d si ripiega
// esattamente quando d supera R.
function cerchio(R, n = 360) {
    const pts = [];
    for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        pts.push({ x: Math.cos(a) * R, z: Math.sin(a) * R, y: 0 });
    }
    return pts;
}

test('nessun ripiegamento quando il muro sta dentro il raggio', () => {
    const pts = cerchio(100);
    const r = Forma.ripiegamenti(pts, () => 40);
    assert.equal(r.length, 0, `attesi 0 ripiegamenti, trovati ${r.length}`);
});

test('tutti i campioni si ripiegano quando il muro supera il raggio', () => {
    const pts = cerchio(100);
    // il lato interno del cerchio è uno solo: metà dei campioni-lato
    const r = Forma.ripiegamenti(pts, () => 130);
    assert.equal(r.length, pts.length,
        `atteso un ripiegamento per campione sul lato interno, trovati ${r.length}`);
});

test('il passo minimo del nastro si accorcia sul lato interno', () => {
    const pts = cerchio(100);
    const largo = Forma.passoMinimo(pts, () => 0).lunghezza;
    const stretto = Forma.passoMinimo(pts, () => 50).lunghezza;
    assert.ok(stretto < largo,
        `il nastro interno dovrebbe avere passo più corto: ${stretto} contro ${largo}`);
});

test('due segmenti che si incrociano vengono trovati', () => {
    // Pista a otto stretto: il muro largo fa incrociare i due rami.
    const pts = [];
    for (let i = 0; i < 200; i++) {
        const t = (i / 200) * Math.PI * 2;
        pts.push({ x: Math.cos(t) * 120, z: Math.sin(t * 2) * 60, y: 0 });
    }
    // Finestra esplicita: l'otto si taglia da solo al centro (campioni 50 e
    // 149 sono lo stesso punto della pista), e con la finestra di default —
    // 120 campioni su 200, più di metà giro — quell'incrocio della centerline
    // verrebbe contato come difetto del muro. Sui tracciati veri, 1000
    // campioni, il default resta locale; qui la scala è un quinto.
    const finestra = 80;
    const nessuno = Forma.autoIntersezioni(pts, () => 1, finestra);
    const molti = Forma.autoIntersezioni(pts, () => 55, finestra);
    assert.equal(nessuno.length, 0, 'con muro a ridosso non ci sono incroci');
    assert.ok(molti.length > 0, 'con muro largo gli incroci devono comparire');
});
