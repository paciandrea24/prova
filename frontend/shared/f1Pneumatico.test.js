// frontend/shared/f1Pneumatico.test.js
//
// Di un disegno si verifica quello che si puo' verificare senza guardarlo: che
// sia SVG valido, che il colore della mescola arrivi davvero nel disegno (e non
// resti quello di prima), e che le tre mescole siano distinguibili anche senza
// colore — che e' la cosa che si rompe per prima quando si ritocca il
// battistrada e nessuno se ne accorge finche' qualcuno gioca in bianco e nero
// o con una mescola daltonica.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('./f1Pneumatico');

test('e SVG ben formato, con tutti i tag chiusi', () => {
    for (const m of ['hard', 'medium', 'soft']) {
        const s = P.svg(m, '#e74c3c');
        assert.ok(s.startsWith('<svg'), 'non comincia con <svg');
        assert.ok(s.trim().endsWith('</svg>'), 'non finisce con </svg>');
        // Tanti tag aperti quanti chiusi, per ogni tipo usato.
        for (const tag of ['circle', 'line']) {
            const aperti = (s.match(new RegExp(`<${tag}\\b`, 'g')) || []).length;
            const autochiusi = (s.match(new RegExp(`<${tag}\\b[^>]*/>`, 'g')) || []).length;
            assert.equal(aperti, autochiusi, `${tag}: ${aperti} aperti ma ${autochiusi} chiusi`);
        }
        assert.ok(!/NaN|undefined/.test(s), 'il disegno contiene NaN o undefined');
    }
});

test('il colore della mescola finisce nella fascia', () => {
    const s = P.svg('soft', '#e74c3c');
    assert.ok(s.includes('stroke="#e74c3c"'), 'il colore non compare nel disegno');
    // E non finisce anche altrove: la fascia deve essere l'UNICA parte colorata,
    // come sulle gomme vere.
    assert.equal((s.match(/#e74c3c/g) || []).length, 1);
});

test('senza colore non esplode: resta una gomma grigia', () => {
    const s = P.svg('medium', null);
    assert.ok(s.includes('<svg'), 'senza colore non disegna niente');
    assert.ok(!/NaN|undefined|null/.test(s));
});

test('le tre mescole si distinguono anche a colori spenti', () => {
    // Il battistrada e piu fitto sulla dura e piu aperto sulla morbida: e'
    // l'unico segno che resta se il colore non si vede.
    const tacche = (m) => (P.svg(m, '#fff').match(/<line/g) || []).length;
    const hard = tacche('hard'), medium = tacche('medium'), soft = tacche('soft');
    assert.ok(hard > medium && medium > soft,
        `battistrada non distinguibili: hard ${hard}, medium ${medium}, soft ${soft}`);
    // Le razze del cerchio sono in tutte e tre: la differenza deve venire dal
    // battistrada, non dall'aver perso pezzi del disegno.
    assert.ok(soft > P.RAZZE, 'la mescola morbida ha perso il battistrada');
});

test('una mescola sconosciuta non rompe il disegno', () => {
    // Se un giorno se ne aggiunge una (intermedie, bagnato) il disegno deve
    // uscire comunque, con una densita di mezzo.
    const s = P.svg('intermedie', '#3498db');
    const tacche = (s.match(/<line/g) || []).length;
    assert.ok(tacche > P.RAZZE, 'nessun battistrada per una mescola sconosciuta');
    assert.ok(s.includes('#3498db'));
});

test('l etichetta accessibile compare solo quando gliene si da una', () => {
    assert.ok(P.svg('hard', '#fff').includes('aria-hidden="true"'),
        'senza titolo deve essere invisibile agli screen reader: e decorazione');
    const conTitolo = P.svg('hard', '#fff', { titolo: 'Mescola dura' });
    assert.ok(conTitolo.includes('<title>Mescola dura</title>'));
    assert.ok(conTitolo.includes('aria-label="Mescola dura"'));
});
