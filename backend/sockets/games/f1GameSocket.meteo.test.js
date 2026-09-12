const test = require('node:test');
const assert = require('node:assert/strict');
const F1 = require('./f1GameSocket');
const { loadTrack } = require('./trackLoader');

function partita() {
    const track = loadTrack('prova');
    return { track, phase: 'race', raceTick: 0, players: {}, meteo: null };
}

test('meteo: nasce prima della scelta gomme e la pista parte bagnata se piove', () => {
    const g = partita();
    F1.creaMeteo(g, { seme: 7, archetipo: 'bagnatoCheScampa' });
    assert.ok(g.meteo && g.meteo.griglia, 'nessun meteo creato');
    assert.ok(g.meteo.pioggia > 0.5, 'l\'archetipo bagnato non parte bagnato');
    const M = require('../../../frontend/shared/f1Meteo.js');
    assert.ok(M.bagnatoIn(g.meteo.griglia, 0, 0) > 0.5,
        'il cielo dice pioggia ma la pista e\' asciutta: la griglia non e\' stata inizializzata');
});

test('meteo: scrive p.bagnato sotto ogni auto, e il bordo e piu bagnato della traiettoria', () => {
    const g = partita();
    // ⚠️ Un archetipo che parte BAGNATO: su uno che parte asciutto non c'e'
    // acqua da togliere e il test misurerebbe zero contro zero.
    F1.creaMeteo(g, { seme: 7, archetipo: 'bagnatoCheScampa' });
    const punti = g.track.points;
    const inTraiettoria = { x: punti[300].x, z: punti[300].z, trackIndex: 300, compound: 'intermedie', tyreWear: 0 };
    // Cento passaggi in traiettoria, nessuno al bordo.
    for (let i = 0; i < 100; i++) {
        F1.avanzaMeteo(g, 20, [Object.assign({}, inTraiettoria, { vx: 0, vz: 6 })]);
    }
    F1.updateTrackIndex(inTraiettoria, g.track, g.meteo);
    assert.equal(typeof inTraiettoria.bagnato, 'number', 'p.bagnato non e\' stato scritto');
    const M = require('../../../frontend/shared/f1Meteo.js');
    const centro = M.bagnatoIn(g.meteo.griglia, 300, 0);
    const bordo  = M.bagnatoIn(g.meteo.griglia, 300, 1);
    assert.ok(bordo > centro, 'la traiettoria non si e\' asciugata piu\' del bordo');
});

test('meteo: lo scavalco di F3 vince sul profilo e non lo cancella', () => {
    const g = partita();
    F1.creaMeteo(g, { seme: 7, archetipo: 'asciutto' });
    g.meteo.scavalco = 1;
    F1.avanzaMeteo(g, 1000, []);
    assert.equal(g.meteo.pioggia, 1, 'lo scavalco non comanda');
    g.meteo.scavalco = null;
    F1.avanzaMeteo(g, 1000, []);
    assert.equal(g.meteo.pioggia, 0, 'togliendo lo scavalco il profilo non e\' tornato a comandare');
});

test('meteo: due partite sulla stessa pista non si scambiano l acqua', () => {
    // ⚠️ `loadTrack` CACHEA le piste per id: le due partite hanno lo STESSO
    // oggetto pista. Se la griglia del bagnato vivesse appesa alla pista, due
    // lobby sullo stesso circuito si scambierebbero il meteo in diretta, e la
    // gara dopo comincerebbe sull'acqua di quella prima.
    const g1 = partita(), g2 = partita();
    assert.equal(g1.track, g2.track, 'il caricatore non cachea piu: questo test non misura niente');
    F1.creaMeteo(g1, { seme: 7, archetipo: 'bagnatoCheScampa' });
    F1.creaMeteo(g2, { seme: 7, archetipo: 'asciutto' });
    assert.ok(g1.meteo.pioggia > 0.5, 'la prima partita non e bagnata');
    assert.equal(g2.meteo.pioggia, 0, 'la seconda partita non e asciutta');
    const p1 = { x: 0, z: 0, trackIndex: 300, compound: 'medium' };
    const p2 = { x: 0, z: 0, trackIndex: 300, compound: 'medium' };
    F1.updateTrackIndex(p1, g1.track, g1.meteo);
    F1.updateTrackIndex(p2, g2.track, g2.meteo);
    assert.ok(p1.bagnato > 0.5, 'l auto della gara bagnata non trova acqua');
    assert.equal(p2.bagnato, 0, 'l auto della gara asciutta ha trovato l acqua dell altra partita');
});

test('F3: solo un amministratore puo cambiare il cielo', () => {
    const g = partita();
    F1.creaMeteo(g, { seme: 7, archetipo: 'asciutto' });
    // Nessun uid amministratore configurato: la richiesta non deve passare.
    delete process.env.F1_ADMIN_UIDS;
    assert.equal(F1.applicaScavalcoMeteo(g, 'nessuno', 'diluvio'), false);
    assert.equal(g.meteo.scavalco, null);

    process.env.F1_ADMIN_UIDS = 'uid-capo';
    assert.equal(F1.applicaScavalcoMeteo(g, 'uid-capo', 'diluvio'), true);
    assert.equal(g.meteo.scavalco, 1);
    assert.equal(F1.applicaScavalcoMeteo(g, 'uid-capo', null), true);
    assert.equal(g.meteo.scavalco, null);
    // Un livello inventato non deve diventare NaN nella fisica.
    assert.equal(F1.applicaScavalcoMeteo(g, 'uid-capo', 'grandine'), false);
    delete process.env.F1_ADMIN_UIDS;
});
