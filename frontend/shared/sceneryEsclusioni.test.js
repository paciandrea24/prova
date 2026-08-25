// frontend/shared/sceneryEsclusioni.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const SceneryEsclusioni = require('./sceneryEsclusioni.js');

const voce = (asset, x, z) => ({ asset, category: 'nature', x, y: 0, z, rotY: 0, scale: 1 });

test('l\'identificatore mette insieme asset e posizione', () => {
    assert.equal(SceneryEsclusioni.idDi(voce('treePine', 12.34, -5.67)), 'treePine@12.3,-5.7');
    // Due oggetti diversi nello stesso punto hanno id diversi: la posizione da
    // sola non basta (una tribuna e la sua rete quasi coincidono).
    assert.notEqual(SceneryEsclusioni.idDi(voce('treePine', 1, 2)),
                    SceneryEsclusioni.idDi(voce('rockSingle', 1, 2)));
    // Lo stesso asset in due punti diversi, idem.
    assert.notEqual(SceneryEsclusioni.idDi(voce('treePine', 1, 2)),
                    SceneryEsclusioni.idDi(voce('treePine', 1, 3)));
});

test('le voci senza modello non hanno identificatore', () => {
    // Laghetto e asfalto del parcheggio sono superfici costruite altrove:
    // non sono oggetti che si possano togliere uno per uno.
    assert.equal(SceneryEsclusioni.idDi({ category: 'pond', x: 1, z: 2 }), null);
    assert.equal(SceneryEsclusioni.idDi(null), null);
});

test('applica toglie esattamente gli oggetti elencati', () => {
    const layout = [voce('treePine', 10, 20), voce('rockSingle', 30, 40), voce('treePine', 50, 60)];
    const id = SceneryEsclusioni.idDi(layout[1]);
    const out = SceneryEsclusioni.applica(layout, [id]);
    assert.equal(out.layout.length, 2);
    assert.ok(!out.layout.some(v => v.asset === 'rockSingle'));
    assert.deepEqual(out.nonTrovate, []);
    // L'array di partenza non si tocca.
    assert.equal(layout.length, 3);
});

test('senza esclusioni il layout torna intero, ma in un array nuovo', () => {
    const layout = [voce('treePine', 10, 20)];
    for (const esclusi of [undefined, null, [], [null]]) {
        const out = SceneryEsclusioni.applica(layout, esclusi);
        assert.equal(out.layout.length, 1);
        assert.deepEqual(out.nonTrovate, []);
        assert.notEqual(out.layout, layout, 'deve essere un array nuovo');
    }
});

// ⚠️ È IL PUNTO DELICATO. Un'esclusione salvata ieri può non trovare più il suo
// oggetto: basta che l'algoritmo di posizionamento cambi e quell'albero nasca
// mezzo metro più in là. Se il filtro tacesse, l'autore crederebbe di aver
// tolto una cosa che invece è ancora in pista — la stessa trappola del
// fallback silenzioso che ha fatto finire due container dentro la carreggiata.
test('un\'esclusione che non trova il suo oggetto viene DETTA, non ignorata', () => {
    const layout = [voce('treePine', 10, 20)];
    const out = SceneryEsclusioni.applica(layout, ['treePine@99.0,99.0', 'treePine@10.0,20.0']);
    assert.equal(out.layout.length, 0);
    assert.deepEqual(out.nonTrovate, ['treePine@99.0,99.0']);
});

test('due oggetti identici nello stesso punto se ne vanno insieme', () => {
    // Non è un caso di scuola: la folla ha molte figure sovrapposte al
    // decimo. Toglierne "una" non ha senso, e il modulo non finge di poterlo
    // fare: l'id descrive un posto, non un'istanza.
    const layout = [voce('spectatorA', 5, 5), voce('spectatorA', 5, 5), voce('treePine', 0, 0)];
    const out = SceneryEsclusioni.applica(layout, ['spectatorA@5.0,5.0']);
    assert.equal(out.layout.length, 1);
    assert.deepEqual(out.nonTrovate, []);
});
