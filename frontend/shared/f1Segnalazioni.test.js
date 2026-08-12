const test = require('node:test');
const assert = require('node:assert/strict');
const F1Segnalazioni = require('./f1Segnalazioni.js');

const STATO = {
    sessione: '20260812-141230-abc',
    t: '2026-08-12T14:12:41.310Z',
    trackId: 'prova',
    pos: { x: 123.456, y: 2.109, z: -88.702 },
    rotY: Math.PI / 2,
    camera: 'third',
    guardaDietro: false,
    velocita: 143.7,
    giro: 2
};

test('rotY 0 guarda verso +Z, cioè zero gradi', () => {
    assert.equal(F1Segnalazioni.gradiDaRotY(0), 0);
});

test('un quarto di giro vale 90 gradi', () => {
    assert.equal(Math.round(F1Segnalazioni.gradiDaRotY(Math.PI / 2)), 90);
});

test('gli angoli negativi rientrano in [0,360)', () => {
    assert.equal(Math.round(F1Segnalazioni.gradiDaRotY(-Math.PI / 2)), 270);
});

test('oltre il giro completo si normalizza', () => {
    // rotY arriva dal server e non è limitato a un giro: senza
    // normalizzazione finirebbero nel file angoli come 900°, che non si
    // confrontano con la tangente della pista.
    assert.equal(Math.round(F1Segnalazioni.gradiDaRotY(5 * Math.PI)), 180);
});

test('il record non porta il progressivo: lo assegna il server', () => {
    const rec = F1Segnalazioni.componiSegnalazione(STATO);
    assert.equal('n' in rec, false);
});

test('le coordinate sono arrotondate a due decimali', () => {
    const rec = F1Segnalazioni.componiSegnalazione(STATO);
    assert.deepEqual(rec.pos, { x: 123.46, y: 2.11, z: -88.7 });
});

test('la velocità è quella dell HUD, intera', () => {
    const rec = F1Segnalazioni.componiSegnalazione(STATO);
    assert.equal(rec.velocita, 144);
});

test('il giro ignoto diventa null, non zero', () => {
    // Zero è un giro valido (prima del traguardo): confonderlo con
    // "non lo so" renderebbe illeggibile la lista.
    const rec = F1Segnalazioni.componiSegnalazione({ ...STATO, giro: null });
    assert.equal(rec.giro, null);
    assert.equal(F1Segnalazioni.componiSegnalazione({ ...STATO, giro: 0 }).giro, 0);
});

test('l id di sessione contiene data, ora e una coda casuale', () => {
    const id = F1Segnalazioni.nuovaSessioneId(new Date(2026, 7, 12, 14, 12, 30), () => 0.5);
    assert.match(id, /^20260812-141230-[0-9a-z]{3}$/);
});
