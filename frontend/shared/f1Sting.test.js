// frontend/shared/f1Sting.test.js
//
// Lo stacco sta ORA nel percorso critico fra la qualifica e la gara: la
// sequenza prosegue solo quando la sua Promise si risolve. Se per qualunque
// motivo non si risolvesse, il giocatore resterebbe a schermo nero mentre il
// semaforo scatta senza di lui.
//
// Questi test proteggono quell'unico contratto - la Promise si risolve SEMPRE
// - nei casi in cui l'ambiente non e' quello previsto. L'aspetto grafico non
// e' verificabile qui e non si finge di farlo: si guarda dal browser.
const test = require('node:test');
const assert = require('node:assert/strict');

const F1Sting = require('./f1Sting.js');

test('espone play e stop', () => {
    assert.equal(typeof F1Sting.play, 'function');
    assert.equal(typeof F1Sting.stop, 'function');
});

test('senza DOM la Promise si risolve subito, non blocca chi la aspetta', async () => {
    assert.equal(typeof globalThis.document, 'undefined',
        'questo test vale solo dove un DOM non esiste');
    await F1Sting.play({ durataMs: 999999 });
    // Se arriviamo qui senza timeout del runner, non ha bloccato.
});

test('senza anime.js aspetta la durata e poi prosegue', (t) => {
    // Ripiego: se la libreria di animazione non c'e' (CDN irraggiungibile),
    // lo stacco non anima ma la sequenza deve andare avanti lo stesso, con i
    // tempi giusti - il server ha gia' programmato il semaforo.
    t.mock.timers.enable({ apis: ['setTimeout'] });
    globalThis.document = {};   // c'e' un DOM, ma nessun anime
    t.after(() => { delete globalThis.document; });

    let risolta = false;
    F1Sting.play({ durataMs: 2600 }).then(() => { risolta = true; });

    t.mock.timers.tick(2500);
    assert.equal(risolta, false, 'si e risolta prima della durata richiesta');
    t.mock.timers.tick(200);
    return Promise.resolve().then(() => {
        assert.equal(risolta, true, 'non si e risolta allo scadere della durata');
    });
});

// Protegge dal caso in cui il server non mandi le durate (versione vecchia,
// evento troncato): senza difese `undefined` diventerebbe NaN dentro i calcoli
// della timeline, e uno stacco di durata nulla sarebbe un lampo
// incomprensibile.
test('senza durata vale il default del modulo, non zero', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    globalThis.document = {};
    t.after(() => { delete globalThis.document; });

    let risolta = false;
    F1Sting.play({}).then(() => { risolta = true; });
    t.mock.timers.tick(2599);
    assert.equal(risolta, false, 'si e risolta prima del default: la durata mancante e stata letta come zero');
    t.mock.timers.tick(2);
    return Promise.resolve().then(() => assert.equal(risolta, true));
});

test('una durata ridicola viene alzata al minimo leggibile', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    globalThis.document = {};
    t.after(() => { delete globalThis.document; });

    let risolta = false;
    F1Sting.play({ durataMs: 40 }).then(() => { risolta = true; });
    t.mock.timers.tick(599);
    assert.equal(risolta, false, '40 ms sono stati presi alla lettera: sarebbe un lampo, non uno stacco');
    t.mock.timers.tick(2);
    return Promise.resolve().then(() => assert.equal(risolta, true));
});

test('stop non esplode se non c e niente a schermo', () => {
    globalThis.document = { getElementById: () => null };
    try {
        F1Sting.stop();
    } finally {
        delete globalThis.document;
    }
});
