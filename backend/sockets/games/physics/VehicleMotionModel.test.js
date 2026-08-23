// backend/sockets/games/physics/VehicleMotionModel.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { integratePosition, applyOffTrackDrag } = require('./VehicleMotionModel');

test('integratePosition: integra x/z da vx/vz*dt', () => {
    const p = { x: 1, z: 2, vx: 3, vz: -4 };
    integratePosition(p, 1 / 13);
    assert.ok(Math.abs(p.x - 1.2307692307692308) < 1e-12);
    assert.ok(Math.abs(p.z - 1.6923076923076923) < 1e-12);
});

// applyOffTrackDrag restituisce ora un OGGETTO, non un booleano: calcolava
// gia' quanto si e' finiti fuori (la profondita' del drag) e buttava via il
// numero, che serve al danno al fondo. Rif.
// docs/superpowers/specs/2026-08-23-f1-economia-della-gara-design.md.
//
// ATTENZIONE per chi tocchera' i chiamanti: un oggetto e' SEMPRE vero. Un
// chiamante rimasto indietro non da' errore — crede di essere fuori pista ad
// ogni tick.
test("applyOffTrackDrag: entro roadHalf+2, nessun drag, non e' fuori pista", () => {
    const track = { points: [{ x: 0, z: 0 }], roadHalf: 10 };
    const p = { x: 5, z: 0, speed: 5, vx: 5, vz: 0 };
    const { offTrack, profondita } = applyOffTrackDrag(p, track);
    assert.equal(offTrack, false);
    assert.equal(profondita, 0);
    assert.equal(p.speed, 5);
});

test("applyOffTrackDrag: appena oltre il limite, drag e profondita' parziali", () => {
    const track = { points: [{ x: 0, z: 0 }], roadHalf: 10 };
    const p = { x: 14, z: 0, speed: 5, vx: 5, vz: 0 };   // dist=14, limite=12, k=0.25
    const { offTrack, profondita } = applyOffTrackDrag(p, track);
    assert.equal(offTrack, true);
    assert.ok(Math.abs(profondita - 0.25) < 1e-12, `attesa profondita 0.25, ottenuta ${profondita}`);
    assert.ok(Math.abs(p.speed - 4.699999999999999) < 1e-9);
});

test("applyOffTrackDrag: molto oltre il limite, drag e profondita' saturati", () => {
    const track = { points: [{ x: 0, z: 0 }], roadHalf: 10 };
    const p = { x: 25, z: 0, speed: 5, vx: 5, vz: 0 };   // dist=25, ben oltre limite+8
    const { offTrack, profondita } = applyOffTrackDrag(p, track);
    assert.equal(offTrack, true);
    assert.equal(profondita, 1);
    assert.ok(Math.abs(p.speed - 4.4) < 1e-9);
});

test("applyOffTrackDrag: SUL CORDOLO non si e' fuori pista", () => {
    // I 2 unita' oltre roadHalf sono la fascia del cordolo. Il cordolo non
    // deve danneggiare il fondo: e' una richiesta esplicita dell'utente, e la
    // soglia gia' esistente la soddisfa da sola. Questo test difende quella
    // coincidenza, che altrimenti nessuno saprebbe di dover mantenere.
    const track = { points: [{ x: 0, z: 0 }], roadHalf: 10 };
    const p = { x: 11.5, z: 0, speed: 5, vx: 5, vz: 0 };
    const { offTrack, profondita } = applyOffTrackDrag(p, track);
    assert.equal(offTrack, false, "il cordolo non e' fuori pista");
    assert.equal(profondita, 0);
    assert.equal(p.speed, 5, 'e non rallenta');
});
