// frontend/shared/f1Premiazione.test.js
//
// La coreografia della premiazione: chi entra, quando, e per quanto. Sono i
// numeri che in un'animazione non si possono controllare guardandola — a occhio
// si vede se "e' troppo lunga", non se il secondo entra prima del terzo.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('./f1Premiazione');

test('si sale dal terzo al primo, mai il contrario', () => {
    const copione = P.copione(3);
    assert.deepEqual(copione.map(b => b.posto), [3, 2, 1, 0]);
    // Nessun buco e nessuna sovrapposizione: ogni battuta comincia dove
    // finisce la precedente.
    for (let i = 1; i < copione.length; i++) {
        assert.equal(copione[i].da, copione[i - 1].a, `battuta ${i} non attaccata alla precedente`);
    }
    assert.equal(copione[0].da, 0);
    assert.equal(copione[copione.length - 1].a, P.durataTotale(3));
});

test('con meno di tre piloti la cerimonia esiste lo stesso', () => {
    // Una stagione si puo' correre in due, o da soli con un bot. Un podio a
    // tre posti fissi si romperebbe proprio nel caso piu' comune del gioco in
    // singolo.
    assert.deepEqual(P.copione(1).map(b => b.posto), [1, 0]);
    assert.deepEqual(P.copione(2).map(b => b.posto), [2, 1, 0]);
    assert.ok(P.durataTotale(1) < P.durataTotale(3));
    // Piu' di tre non esistono: il podio ha tre gradini.
    assert.deepEqual(P.copione(20).map(b => b.posto), [3, 2, 1, 0]);
});

test('lo stato dice sempre chi sta entrando e a che punto e', () => {
    const copione = P.copione(3);
    const D = P.DURATE;

    const inizio = P.stato(copione, 0);
    assert.equal(inizio.posto, 3);
    assert.equal(inizio.fase, 'arrivo');
    assert.ok(inizio.avanzamento < 0.01);

    // A meta' dell'arrivo del terzo.
    const meta = P.stato(copione, D.arrivo / 2);
    assert.equal(meta.posto, 3);
    assert.equal(meta.fase, 'arrivo');
    assert.ok(Math.abs(meta.avanzamento - 0.5) < 0.02);

    // Appena dopo l'arrivo comincia la salita, sempre dello stesso.
    const salita = P.stato(copione, D.arrivo + 10);
    assert.equal(salita.posto, 3);
    assert.equal(salita.fase, 'salita');

    // Poi la sosta, sempre dello stesso.
    const sosta = P.stato(copione, D.arrivo + D.salita + 10);
    assert.equal(sosta.posto, 3);
    assert.equal(sosta.fase, 'sosta');

    // Il primo entra per ultimo, e dopo di lui c'e' l'apoteosi.
    const battutaPrimo = copione.find(b => b.posto === 1);
    assert.equal(P.stato(copione, battutaPrimo.da + 10).posto, 1);
    assert.equal(P.stato(copione, battutaPrimo.a + 10).fase, 'apoteosi');

    // Oltre la fine non si ricomincia da capo.
    const dopo = P.stato(copione, P.durataTotale(3) + 5000);
    assert.equal(dopo.fase, 'finita');
    assert.equal(dopo.avanzamento, 1);
    // E nemmeno prima dell'inizio: un tempo negativo (orologio che scarta) non
    // deve far entrare nessuno due volte.
    assert.equal(P.stato(copione, -500).posto, 3);
    assert.equal(P.stato(copione, -500).fase, 'arrivo');
});

test('l avanzamento di ogni fase copre tutto l intervallo, senza saltare', () => {
    // Se una fase non arrivasse mai vicino a 1, l'auto si fermerebbe prima di
    // toccare il gradino e ci salterebbe sopra nell'istante del cambio.
    const copione = P.copione(3);
    const D = P.DURATE;
    const quasiFineArrivo = P.stato(copione, D.arrivo - 1);
    assert.equal(quasiFineArrivo.fase, 'arrivo');
    assert.ok(quasiFineArrivo.avanzamento > 0.99, 'l arrivo non arriva a destinazione');
    const quasiFineSalita = P.stato(copione, D.arrivo + D.salita - 1);
    assert.equal(quasiFineSalita.fase, 'salita');
    assert.ok(quasiFineSalita.avanzamento > 0.99, 'la salita non arriva sul gradino');
});
