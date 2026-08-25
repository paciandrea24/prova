// backend/tools/f1-banking-taratura.test.js
//
// Il banco e' uno strumento di taratura, non codice di gioco: qui si controlla
// solo che continui a misurare qualcosa di sensato, cioe' che non marcisca in
// silenzio la prossima volta che la fisica cambia.
const test = require('node:test');
const assert = require('node:assert/strict');
const { raggioASterzoPieno, velocitaMax } = require('./f1-banking-taratura.js');

const G = g => g * Math.PI / 180;

test('a sterzo pieno una curva sopraelevata si percorre piu\' stretta', () => {
    const v = 3.5;
    const piana = raggioASterzoPieno(0, v);
    const banked = raggioASterzoPieno(G(18), v);
    assert.ok(banked < piana, `banked ${banked} non e' piu' stretto di piano ${piana}`);
});

test('piu\' sopraelevazione, piu\' velocita\' nella stessa curva', () => {
    const R = 70;
    const piana = velocitaMax(0, R);
    const media = velocitaMax(G(18), R);
    const ripida = velocitaMax(G(35), R);
    assert.ok(media > piana && ripida > media,
        `velocita' non crescente: ${piana} → ${media} → ${ripida}`);
});

test('su una curva larga il banking non cambia niente: si passava gia\' in pieno', () => {
    // Il tetto di velocita' e' lo stesso, e non lo sfonda: se un giorno questo
    // test cadesse, il banking starebbe aumentando la velocita' MASSIMA
    // dell'auto invece della sua tenuta.
    const R = 400;
    assert.equal(velocitaMax(G(45), R), velocitaMax(0, R));
});
