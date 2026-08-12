const test = require('node:test');
const assert = require('node:assert/strict');
const tool = require('./f1-segnalazioni.js');

// Anello quadrato di comodo: 40 campioni su un giro di lato 100, così la
// progressione e la distanza dall'asse hanno valori a mente.
function anelloDiProva() {
    const pts = [];
    for (let i = 0; i < 40; i++) {
        const t = i / 40, lato = Math.floor(t * 4), u = (t * 4) % 1;
        if (lato === 0) pts.push({ x: -50 + u * 100, y: 0, z: -50 });
        else if (lato === 1) pts.push({ x: 50, y: 0, z: -50 + u * 100 });
        else if (lato === 2) pts.push({ x: 50 - u * 100, y: 0, z: 50 });
        else pts.push({ x: -50, y: 0, z: 50 - u * 100 });
    }
    return pts;
}

test('un punto sull asse risulta dentro pista, a distanza zero', () => {
    const d = tool.descriviPuntoPista(anelloDiProva(), 10, { pos: { x: 0, y: 0, z: -50 } });
    assert.equal(d.dentroPista, true);
    assert.ok(d.distanzaAsse < 0.001);
});

test('un punto oltre il bordo risulta fuori pista', () => {
    // roadHalf 10: a 25 unità dall asse si è fuori di sicuro.
    const d = tool.descriviPuntoPista(anelloDiProva(), 10, { pos: { x: 0, y: 0, z: -75 } });
    assert.equal(d.dentroPista, false);
    assert.ok(Math.abs(d.distanzaAsse - 25) < 0.001);
});

test('la progressione dice a che punto del giro sei', () => {
    // L'angolo a metà anello (50, 50) è esattamente il campione 20 su 40.
    const d = tool.descriviPuntoPista(anelloDiProva(), 10, { pos: { x: 50, y: 0, z: 50 } });
    assert.equal(d.indice, 20);
    assert.equal(d.progressione, 50);
});

test('un oggetto nella stessa direzione del muso è davanti', () => {
    assert.equal(tool.direzioneRelativa(90, 90), 'davanti');
});

test('un oggetto a 180 gradi dal muso è dietro', () => {
    assert.equal(tool.direzioneRelativa(90, 270), 'dietro');
});

test('la destra è la destra del pilota, non quella della mappa', () => {
    // Convenzione del gioco: rotY cresce verso +X, quindi un angolo MAGGIORE
    // del muso sta alla destra di chi guida.
    assert.equal(tool.direzioneRelativa(0, 90), 'a destra');
    assert.equal(tool.direzioneRelativa(0, 270), 'a sinistra');
});
