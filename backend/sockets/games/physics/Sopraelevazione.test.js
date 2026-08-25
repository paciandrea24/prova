// backend/sockets/games/physics/Sopraelevazione.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { fattoreBanking, BANKING_GUADAGNO_MAX, ROLLIO_MAX } = require('./Sopraelevazione');

test('senza sopraelevazione il fattore e\' esattamente 1', () => {
    // Le piste piane non devono cambiare di una virgola: 1 esatto, non 0.9999.
    assert.equal(fattoreBanking(0), 1);
    assert.equal(fattoreBanking(undefined), 1);
});

test('il guadagno cresce col rollio', () => {
    const a = fattoreBanking(10 * Math.PI / 180);
    const b = fattoreBanking(30 * Math.PI / 180);
    assert.ok(b > a, `${b} non e' maggiore di ${a}`);
});

test('al rollio massimo il guadagno e\' esattamente il tetto, e non oltre', () => {
    // Una curva non deve mai diventare gratis.
    assert.ok(Math.abs(fattoreBanking(ROLLIO_MAX) - (1 + BANKING_GUADAGNO_MAX)) < 1e-12);
    // Un rollio oltre il massimo (che il caricatore gia' rifiuta) non deve
    // comunque sfondare il tetto qui.
    assert.equal(fattoreBanking(80 * Math.PI / 180), 1 + BANKING_GUADAGNO_MAX);
});

test('un rollio malformato vale piano, mai NaN', () => {
    // Un NaN qui si propagherebbe alla traiettoria senza un errore che lo dica.
    for (const cattivo of [undefined, null, NaN, Infinity, -0.3, 'venti', {}]) {
        assert.equal(fattoreBanking(cattivo), 1, `rollio ${String(cattivo)}`);
    }
});

// ⚠️ Il test che tiene insieme i due consumatori: la sterzata (dove il banking
// si ESEGUE) e la capacita' laterale (dove il bot DECIDE quanto frenare) devono
// leggere lo STESSO numero. Con il fattore da una parte sola il bot entrava in
// curva contando su un'aderenza che la fisica non gli dava: misurato un giro
// piu' lento del 12% col banking acceso.
test('la sterzata e la capacita\' laterale usano lo stesso fattore', () => {
    const { applySteering } = require('./SteeringModel');
    const { corneringCapacity } = require('./CorneringGripModel');
    const rollio = 18 * Math.PI / 180;
    const atteso = fattoreBanking(rollio);

    const base = () => ({ speed: 3, vx: 0, vz: 0, angle: 0, inputs: { steer: 1 },
        damageParts: { frontWing: 0, floor: 0, engine: 0, suspension: 0 }, tyreWear: 0 });
    const piano = base(), banked = { ...base(), rollio };
    applySteering(piano, false, 6.2);
    applySteering(banked, false, 6.2);
    assert.ok(Math.abs(banked.angle / piano.angle - atteso) < 1e-12,
        `sterzata: rapporto ${banked.angle / piano.angle}, atteso ${atteso}`);

    const pPiano = { ...base(), tyreWear: 0, rollio: 0 };
    const pBanked = { ...base(), tyreWear: 0, rollio };
    assert.ok(Math.abs(corneringCapacity(pBanked, false, 6.2) / corneringCapacity(pPiano, false, 6.2) - atteso) < 1e-12,
        'capacita\' laterale: rapporto diverso da quello della sterzata');
});
