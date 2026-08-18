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
    t.mock.timers.tick(F1Sting.DURATA_DEFAULT - 1);
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
    t.mock.timers.tick(F1Sting.DURATA_MINIMA - 1);
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

test('il taglio e istantaneo e NON dipende dalla durata', () => {
    // Segnalato in playtest: "ho visto per un secondo il riposizionamento in
    // griglia e anche un rumore di motori, e poi e' partita l'animazione".
    // Una versione dello stacco faceva entrare le lastre da fuori schermo
    // senza niente sotto: finche' non arrivavano, la scena restava visibile -
    // e il server riposiziona le auto in griglia nello stesso istante in cui
    // la qualifica chiude.
    //
    // Coprire e animare sono due lavori diversi. Il fondo va opaco in un
    // tempo FISSO e piccolo; se qualcuno lo rendesse una frazione della
    // durata, uno stacco piu' lungo tornerebbe a lasciare la scena scoperta
    // piu' a lungo - il contrario di quello che serve.
    assert.equal(typeof F1Sting.COPERTURA_MS, 'number');
    assert.ok(F1Sting.COPERTURA_MS <= 200,
        `il taglio dura ${F1Sting.COPERTURA_MS} ms: si vede cosa c'e sotto`);
    assert.ok(F1Sting.COPERTURA_MS < F1Sting.DURATA_MINIMA * F1Sting.F_ENTRATA,
        'il taglio non e piu istantaneo rispetto all entrata: e diventato parte dello spettacolo');
});

test('la sosta e il momento piu lungo dei tre', () => {
    // "La velocita' mi e' sembrata un po' troppa, non ci ho capito niente":
    // il testo e' l'unica informazione dello stacco e va letto a schermo
    // fermo. Se entrata o uscita tornassero a superare la sosta, si
    // ritornerebbe li'.
    const uscita = 1 - F1Sting.F_ENTRATA - F1Sting.F_SOSTA;
    assert.ok(F1Sting.F_SOSTA > F1Sting.F_ENTRATA,
        'l entrata dura piu della sosta: il testo non fa in tempo a essere letto');
    assert.ok(F1Sting.F_SOSTA > uscita,
        'l uscita dura piu della sosta: il testo non fa in tempo a essere letto');
});

// ────────────────────────────────────────────────────────────────────────
// LA BANDA NON DEVE MAI FERMARSI CON UN BORDO DENTRO LO SCHERMO
//
// Segnalato in playtest: "sembra che si bloccano come se ci fosse una linea
// verticale e poi inizia la gara". Le bande sono larghe 220vw a partire da
// -60vw, ma l'uscita le portava solo a +120vw: il loro bordo sinistro si
// fermava a 60vw, cioe' in mezzo allo schermo, e restava li' fermo finche' il
// fondo non sfumava. Stesso difetto in entrata, dove partivano gia' a coprire
// il 40% sinistro invece che da fuori quadro.
//
// Sono tre disuguaglianze fra numeri noti: si verificano qui una volta per
// tutte, invece di riguardare l'animazione al rallentatore.
// ────────────────────────────────────────────────────────────────────────
const bordoSx = (tx) => F1Sting.BANDA_SX_VW + tx;
const bordoDx = (tx) => F1Sting.BANDA_SX_VW + tx + F1Sting.BANDA_LARG_VW;

test('a inizio corsa la banda e tutta fuori schermo a sinistra', () => {
    assert.ok(bordoDx(F1Sting.FUORI_SX) <= 0,
        `il bordo destro parte da ${bordoDx(F1Sting.FUORI_SX)}vw: la banda copre gia parte dello schermo prima di muoversi`);
});

test('a meta corsa la banda copre tutto lo schermo, bordi compresi', () => {
    assert.ok(bordoSx(F1Sting.COPERTO) <= 0,
        `resta scoperta una striscia a sinistra: bordo a ${bordoSx(F1Sting.COPERTO)}vw`);
    assert.ok(bordoDx(F1Sting.COPERTO) >= 100,
        `resta scoperta una striscia a destra: bordo a ${bordoDx(F1Sting.COPERTO)}vw`);
});

test('a fine corsa la banda e tutta fuori schermo a destra', () => {
    assert.ok(bordoSx(F1Sting.FUORI_DX) >= 100,
        `il bordo sinistro si ferma a ${bordoSx(F1Sting.FUORI_DX)}vw, dentro lo schermo: e la "linea verticale" del playtest`);
});
