// frontend/shared/sceneryRegistro.test.js
//
// La porta: l'unico modo di entrare nel layout della scenografia.
// Rif. docs/superpowers/specs/2026-08-24-f1-scenografia-alla-radice-design.md
const test = require('node:test');
const assert = require('node:assert/strict');
const Registro = require('./sceneryRegistro.js');

// Una pista dritta lungo x, larga 10 per lato, con una corsia box parallela.
//
// ⚠️ Campioni fitti (passo 1), come nelle piste vere. TrackGeometry.nearestPoint
// misura la distanza dal CAMPIONE piu' vicino, non dal segmento: con un passo
// di 5 un angolo a 9.25 dall'asse risultava a 9.52, e una penetrazione di 0.75
// si leggeva 0.48 — sotto soglia. Una pista di prova troppo rada non prova il
// codice vero, prova il proprio errore di campionamento.
const PISTA = [];
for (let i = 0; i <= 500; i++) PISTA.push({ x: i, z: 0, y: 0 });
const BOX = [];
for (let i = 0; i <= 500; i++) BOX.push({ x: i, z: 40, y: 0 });

function reg() {
    return Registro.crea({
        trackPts: PISTA, pitPts: BOX, roadHalf: 10, pitRoadHalf: 6,
        playerBoxFootprints: [],
    });
}
const oggetto = (asset, x, z, extra) => Object.assign(
    { asset, category: 'prova', x, y: 0, z, rotY: 0, scale: 1 }, extra || {});

test('posa: un oggetto ben fuori da tutto viene accettato', () => {
    const r = reg();
    assert.equal(r.motivoDiRifiuto(oggetto('marshalPost', 250, 100)), null);
    assert.equal(r.posa(oggetto('marshalPost', 250, 100)), true);
});

test('posa: un oggetto dentro la carreggiata viene rifiutato', () => {
    const r = reg();
    const motivo = r.motivoDiRifiuto(oggetto('marshalPost', 250, 0));
    assert.match(motivo, /carreggiata/i);
    assert.equal(r.posa(oggetto('marshalPost', 250, 0)), false);
});

test('posa: conta gli ANGOLI, non il centro', () => {
    // marshalPost e' 5.5 x 4.5: col centro a z=11.5 il centro e' fuori dalla
    // pista (mezza larghezza 10) ma un angolo entra fino a z=9.25.
    // E' la trappola gia' scritta in docs/f1-notes.md.
    const r = reg();
    assert.ok(r.motivoDiRifiuto(oggetto('marshalPost', 250, 11.5)));
});

test('posa: un oggetto dentro la corsia box viene rifiutato', () => {
    const r = reg();
    assert.match(r.motivoDiRifiuto(oggetto('marshalPost', 250, 40)), /corsia box/i);
});

test('posa: due oggetti lontani convivono', () => {
    const r = reg();
    assert.equal(r.posa(oggetto('grandStand', 100, 100)), true);
    assert.equal(r.posa(oggetto('grandStand', 200, 100)), true);
});

test('posa: un oggetto DENTRO uno gia posato viene rifiutato', () => {
    const r = reg();
    assert.equal(r.posa(oggetto('grandStand', 100, 100)), true);
    assert.match(r.motivoDiRifiuto(oggetto('grandStand', 103, 100)), /compenetra/i);
});

test('posa: un CONTATTO leggero non viene rifiutato', () => {
    // La decisione che regge tutto il piano: sotto la soglia e' un contatto,
    // non un difetto. Toglierlo costerebbe densita' senza correggere niente -
    // gia' misurato il 2026-08-13 (9 alberi in meno su prova, direzioni
    // spoglie dal 16% al 20%, il tetto del test).
    const r = reg();
    assert.equal(r.posa(oggetto('grandStand', 100, 100)), true);
    // grandStand e' largo 19.2: a 19.0 di distanza si sovrappongono di 0.2
    assert.equal(r.motivoDiRifiuto(oggetto('grandStand', 119.0, 100)), null);
});

test('posa: chi viene rifiutato NON resta registrato', () => {
    const r = reg();
    assert.equal(r.posa(oggetto('marshalPost', 250, 0)), false);
    // se fosse rimasto, questo secondo oggetto lontano risulterebbe in conflitto
    assert.equal(r.posa(oggetto('marshalPost', 250, 100)), true);
});

test('aggiungiTutti: registra senza controllare', () => {
    // Serve per cio' che e' stato deciso altrove e non e' negoziabile (i box
    // dei piloti, il ponte dei semafori): il registro deve VEDERLO, non
    // giudicarlo.
    const r = reg();
    r.aggiungiTutti([oggetto('grandStand', 100, 100)]);
    assert.match(r.motivoDiRifiuto(oggetto('grandStand', 103, 100)), /compenetra/i);
});

test('profondita: misura di quanto due ingombri si intersecano', () => {
    const r = reg();
    // grandStand largo 19.2: due centri a 15 di distanza si intersecano di 4.2
    const p = r.profondita(oggetto('grandStand', 100, 100), oggetto('grandStand', 115, 100));
    assert.ok(Math.abs(p - 4.2) < 0.05, `attesa ~4.2, ottenuta ${p}`);
});

test('profondita: zero se non si toccano', () => {
    const r = reg();
    assert.equal(r.profondita(oggetto('grandStand', 100, 100), oggetto('grandStand', 200, 100)), 0);
});

test('crea: senza corsia box non esplode', () => {
    // Una pista puo' non avere pitPts (tracciati minimi dei test).
    const r = Registro.crea({ trackPts: PISTA, pitPts: [], roadHalf: 10, pitRoadHalf: 0, playerBoxFootprints: [] });
    assert.equal(r.motivoDiRifiuto(oggetto('marshalPost', 250, 100)), null);
});

test('posa: un oggetto dentro un box dei piloti viene rifiutato', () => {
    // Il box e' un poligono deciso altrove e non negoziabile.
    const box = [[{ x: 290, z: 95 }, { x: 310, z: 95 }, { x: 310, z: 105 }, { x: 290, z: 105 }]];
    const r = Registro.crea({
        trackPts: PISTA, pitPts: BOX, roadHalf: 10, pitRoadHalf: 6,
        playerBoxFootprints: box,
    });
    assert.match(r.motivoDiRifiuto(oggetto('marshalPost', 300, 100)), /box dei piloti/i);
});
