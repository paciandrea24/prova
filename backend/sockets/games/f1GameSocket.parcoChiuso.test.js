// backend/sockets/games/f1GameSocket.parcoChiuso.test.js
//
// In stagione la macchina non rinasce ad ogni gara. Il punto delicato e' che
// l'azzeramento ha UN SOLO posto (resetStatoAuto): qui si verifica che quel
// posto adesso RIPRISTINA invece di azzerare, e che l'ala fa eccezione.
// Rif. docs/superpowers/specs/2026-08-23-f1-economia-della-gara-design.md
const test = require('node:test');
const assert = require('node:assert/strict');
const { physics } = require('./f1GameSocket.js');

function giocatore(usuraIniziale) {
    const p = {
        damage: 99, damageParts: { frontWing: 9, floor: 9, engine: 9, suspension: 9 },
        tyreWear: 50, inputs: { throttle: 0, brake: 0, steer: 0 },
    };
    if (usuraIniziale) p.usuraIniziale = usuraIniziale;
    return p;
}

test('resetStatoAuto: senza usuraIniziale la macchina e\' nuova, come sempre', () => {
    const p = giocatore();
    physics.resetStatoAuto(p);
    assert.deepEqual(p.damageParts, { frontWing: 0, floor: 0, engine: 0, suspension: 0 });
    assert.equal(p.damage, 0);
});

test('resetStatoAuto: in stagione riparte dall\'usura ereditata', () => {
    const p = giocatore({ frontWing: 40, floor: 12, engine: 35, suspension: 3 });
    physics.resetStatoAuto(p);
    assert.equal(p.damageParts.floor, 12);
    assert.equal(p.damageParts.engine, 35);
    assert.equal(p.damageParts.suspension, 3);
});

test('resetStatoAuto: l\'ala anteriore e\' SEMPRE nuova al via', () => {
    // E' l'eccezione dettata dall'utente: nella F1 vera l'ala la cambiano ai
    // box e via, quindi non fa parte del parco chiuso.
    const p = giocatore({ frontWing: 100, floor: 12, engine: 35, suspension: 3 });
    physics.resetStatoAuto(p);
    assert.equal(p.damageParts.frontWing, 0);
});

test('resetStatoAuto: p.damage resta il massimo dei quattro componenti', () => {
    const p = giocatore({ frontWing: 100, floor: 12, engine: 35, suspension: 3 });
    physics.resetStatoAuto(p);
    assert.equal(p.damage, 35, 'ala azzerata, quindi il massimo e\' il motore');
});

test('resetStatoAuto: l\'oggetto usuraIniziale non viene condiviso per riferimento', () => {
    // Stessa trappola gia' documentata per createDamageParts: due sessioni che
    // condividono lo stesso oggetto si sporcano a vicenda.
    const usura = { frontWing: 0, floor: 12, engine: 35, suspension: 3 };
    const p = giocatore(usura);
    physics.resetStatoAuto(p);
    p.damageParts.floor = 99;
    assert.equal(usura.floor, 12, 'l\'originale non deve muoversi');
});

// Ai box, in stagione, si ripara SOLO l'ala anteriore: e' l'unica cosa che
// nella F1 vera si cambia durante una gara.
test('riparazione ai box: in gara veloce ripara tutto, come sempre', () => {
    const p = { damage: 60, damageParts: { frontWing: 60, floor: 40, engine: 30, suspension: 10 }, pendingRepair: true };
    physics.applicaRiparazione(p);
    assert.deepEqual(p.damageParts, { frontWing: 0, floor: 0, engine: 0, suspension: 0 });
    assert.equal(p.damage, 0);
});

test('riparazione ai box: in stagione ripara SOLO l\'ala', () => {
    const p = {
        damage: 60, damageParts: { frontWing: 60, floor: 40, engine: 30, suspension: 10 },
        pendingRepair: true, usuraIniziale: { frontWing: 0, floor: 20, engine: 20, suspension: 5 },
    };
    physics.applicaRiparazione(p);
    assert.equal(p.damageParts.frontWing, 0, 'l\'ala si cambia');
    assert.equal(p.damageParts.floor, 40, 'il fondo resta');
    assert.equal(p.damageParts.engine, 30, 'il motore resta');
    assert.equal(p.damageParts.suspension, 10, 'le sospensioni restano');
    assert.equal(p.damage, 40, 'p.damage torna il massimo dei quattro');
});

test('durata sosta: in stagione il tempo lo detta l\'ala, non il danno totale', () => {
    // Con la regola vecchia (p.damage) un fondo consumato al 90% avrebbe fatto
    // pagare una sosta lunghissima per cambiare un'ala intatta.
    const stagione = { damage: 90, damageParts: { frontWing: 0, floor: 90, engine: 0, suspension: 0 }, usuraIniziale: {} };
    assert.equal(physics.tempoRiparazioneMs(stagione), 0, 'ala intatta: nessun tempo in piu\'');
});

test('durata sosta: cambiare l\'ala costa un tempo fisso piu\' il proporzionale', () => {
    const p = { damage: 50, damageParts: { frontWing: 50, floor: 0, engine: 0, suspension: 0 }, usuraIniziale: {} };
    const atteso = physics.COSTO_CAMBIO_ALA_MS + 50 * physics.REPAIR_MS_PER_DAMAGE_PCT;
    assert.equal(physics.tempoRiparazioneMs(p), atteso);
});
