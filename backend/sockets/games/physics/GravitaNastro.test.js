const test = require('node:test');
const assert = require('node:assert/strict');
const { G_NASTRO, accelerazionePendenza, isGravitaNastroActive } = require('./GravitaNastro.js');

test('in piano la gravita\' non fa niente', () => {
    assert.equal(accelerazionePendenza(0), 0);
});

test('in salita frena, in discesa spinge', () => {
    assert.ok(accelerazionePendenza(0.1) < 0, 'la salita deve togliere velocita\'');
    assert.ok(accelerazionePendenza(-0.1) > 0, 'la discesa deve darne');
});

test('salita e discesa della stessa pendenza sono simmetriche', () => {
    assert.ok(Math.abs(accelerazionePendenza(0.3) + accelerazionePendenza(-0.3)) < 1e-15);
});

test('a 90 gradi vale tutta la gravita\'', () => {
    assert.ok(Math.abs(accelerazionePendenza(Math.PI / 2) + G_NASTRO) < 1e-12);
});

// Una pendenza mancante o malformata deve valere "piano", non NaN: un NaN in
// p.speed si propaga silenziosamente a posizione, classifica e tempi sul giro.
test('una pendenza assente o non numerica vale zero, mai NaN', () => {
    assert.equal(accelerazionePendenza(undefined), 0);
    assert.equal(accelerazionePendenza(null), 0);
    assert.equal(accelerazionePendenza(NaN), 0);
    assert.equal(accelerazionePendenza('0.2'), 0);
});

test('il flag e\' spento se la variabile d\'ambiente non vale 1', () => {
    const prima = process.env.F1_GRAVITA_NASTRO;
    delete process.env.F1_GRAVITA_NASTRO;
    assert.equal(isGravitaNastroActive(), false);
    process.env.F1_GRAVITA_NASTRO = '0';
    assert.equal(isGravitaNastroActive(), false);
    process.env.F1_GRAVITA_NASTRO = '1';
    assert.equal(isGravitaNastroActive(), true);
    if (prima === undefined) delete process.env.F1_GRAVITA_NASTRO;
    else process.env.F1_GRAVITA_NASTRO = prima;
});
