// backend/tools/f1Telemetria.test.js
//
// Il registratore del giro umano: serve a confrontare come guida una persona
// con come guida il bot, punto per punto lungo il tracciato.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const Telemetria = require('./f1Telemetria.js');

function cartellaTemporanea() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'f1telemetria-'));
}

// Un pilota come lo vede il server a meta' tick.
function pilota(over) {
    return Object.assign({
        color: 'ROSSO', isBot: false, speed: 55.5, trackIndex: 120,
        x: 10, z: -20, inputs: { throttle: 1, brake: 0, steer: 0.25 },
    }, over);
}

test('spenta non accumula niente e non scrive niente', () => {
    const dir = cartellaTemporanea();
    const t = Telemetria.creaRegistratore({ attiva: false, cartella: dir });
    for (let i = 0; i < 10; i++) t.campiona('lobby1', pilota(), i, 16);
    assert.equal(t.chiudiGiro('lobby1', { pista: 'prova', giro: 1 }), null);
    assert.deepEqual(fs.readdirSync(dir), []);
});

test('accesa scrive un file col giro, e ogni campione porta cio\' che serve al confronto', () => {
    const dir = cartellaTemporanea();
    const t = Telemetria.creaRegistratore({ attiva: true, cartella: dir });
    for (let i = 0; i < 5; i++) {
        t.campiona('lobby1', pilota({ trackIndex: i * 10, speed: 50 + i }), i, 16);
    }
    const file = t.chiudiGiro('lobby1', { pista: 'prova', giro: 2 });
    assert.ok(file, 'nessun file scritto');
    const dati = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(dati.pista, 'prova');
    assert.equal(dati.giro, 2);
    assert.equal(dati.colore, 'ROSSO');
    assert.equal(dati.campioni.length, 5);
    // ⚠️ Il tempo si conta in TICK, come fa il simulatore del bot: due
    // orologi diversi non si confrontano.
    assert.deepEqual(dati.campioni[3], {
        t: 48, x: 10, z: -20, v: 53, i: 30, gas: 1, freno: 0, sterzo: 0.25,
    });
});

test('chiuso un giro, il successivo riparte da zero', () => {
    const dir = cartellaTemporanea();
    const t = Telemetria.creaRegistratore({ attiva: true, cartella: dir });
    for (let i = 0; i < 4; i++) t.campiona('lobby1', pilota(), i, 16);
    t.chiudiGiro('lobby1', { pista: 'prova', giro: 1 });
    for (let i = 4; i < 6; i++) t.campiona('lobby1', pilota(), i, 16);
    const file = t.chiudiGiro('lobby1', { pista: 'prova', giro: 2 });
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).campioni.length, 2);
});

test('i bot non si registrano: il loro giro lo da\' gia\' il simulatore', () => {
    const dir = cartellaTemporanea();
    const t = Telemetria.creaRegistratore({ attiva: true, cartella: dir });
    for (let i = 0; i < 5; i++) t.campiona('lobby1', pilota({ isBot: true }), i, 16);
    assert.equal(t.chiudiGiro('lobby1', { pista: 'prova', giro: 1 }), null);
});

test('due piloti nella stessa lobby non si mescolano', () => {
    const dir = cartellaTemporanea();
    const t = Telemetria.creaRegistratore({ attiva: true, cartella: dir });
    for (let i = 0; i < 3; i++) {
        t.campiona('lobby1', pilota({ color: 'ROSSO' }), i, 16);
        t.campiona('lobby1', pilota({ color: 'BLU', speed: 30 }), i, 16);
    }
    const rosso = JSON.parse(fs.readFileSync(
        t.chiudiGiro('lobby1', { pista: 'prova', giro: 1, colore: 'ROSSO' }), 'utf8'));
    const blu = JSON.parse(fs.readFileSync(
        t.chiudiGiro('lobby1', { pista: 'prova', giro: 1, colore: 'BLU' }), 'utf8'));
    assert.equal(rosso.campioni.length, 3);
    assert.equal(blu.campioni.length, 3);
    assert.equal(rosso.campioni[0].v, 55.5);
    assert.equal(blu.campioni[0].v, 30);
});

test('un giro vuoto non scrive un file', () => {
    // Capita al primo passaggio sul traguardo, quando la registrazione e'
    // cominciata dopo: un file con zero campioni farebbe solo confusione.
    const dir = cartellaTemporanea();
    const t = Telemetria.creaRegistratore({ attiva: true, cartella: dir });
    assert.equal(t.chiudiGiro('lobby1', { pista: 'prova', giro: 1 }), null);
    assert.deepEqual(fs.readdirSync(dir), []);
});
