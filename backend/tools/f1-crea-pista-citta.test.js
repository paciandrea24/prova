// backend/tools/f1-crea-pista-citta.test.js
//
// La pista di prova del blocco G. Non prova il generatore: prova che il
// risultato COMMITTATO sia ancora quello che serve al banco di prova.
const test = require('node:test');
const assert = require('node:assert/strict');
const CittaProfilo = require('../../frontend/shared/cittaProfilo.js');
const { loadTrack } = require('../sockets/games/trackLoader.js');

test('citta-prova e\' cittadina, e ha le sue facciate su tutto il giro', () => {
    const track = loadTrack('citta-prova');
    assert.equal(track.ambientazione, 'citta');
    const prof = CittaProfilo.profilo(track.points, track.barrierProfile);
    assert.equal(prof.altezza.length, track.points.length * 2, 'un valore per campione e per lato');
    for (let k = 0; k < prof.altezza.length; k++) {
        assert.ok(prof.altezza[k] >= CittaProfilo.ALTEZZA_MIN,
            `il campione ${Math.floor(k / 2)} non ha facciata (${prof.altezza[k]})`);
    }
});

test('la facciata sta sempre oltre il muro, anche dove la via di fuga allarga', () => {
    // È il punto in cui una distanza fissa avrebbe aperto un varco: `prova` ha
    // vie di fuga larghe fino a 32 unità dal cordolo, e la città deve seguirle.
    const TrackGravel = require('../../frontend/shared/trackGravel.js');
    const track = loadTrack('citta-prova');
    const prof = CittaProfilo.profilo(track.points, track.barrierProfile);
    for (let i = 0; i < track.points.length; i++) {
        for (const side of [1, -1]) {
            const d = prof.distanza[i * 2 + (side > 0 ? 0 : 1)];
            const muro = TrackGravel.barrierAt(track.barrierProfile, i, side);
            assert.ok(d > muro, `campione ${i} lato ${side}: facciata dentro il muro`);
        }
    }
});
