// backend/routes/admin.test.js
//
// Chi vede gli strumenti di sviluppo dentro il gioco. La regola vive in una
// variabile d'ambiente e non nelle preferenze dell'account: un permesso che ti
// dai da solo non e' un permesso.
const test = require('node:test');
const assert = require('node:assert/strict');

function modulo() {
    delete require.cache[require.resolve('./admin.js')];
    return require('./admin.js');
}

test('senza F1_ADMIN_UIDS non e\' amministratore nessuno', () => {
    // ⚠️ E' la condizione giusta per un server pubblico appena acceso: gli
    // strumenti di sviluppo si accendono per scelta, non per dimenticanza.
    delete process.env.F1_ADMIN_UIDS;
    const { eAdmin } = modulo();
    assert.equal(eAdmin('uid-qualunque'), false);
    assert.equal(eAdmin(''), false);
    assert.equal(eAdmin(undefined), false);
});

test('riconosce gli uid in elenco, e solo quelli', () => {
    process.env.F1_ADMIN_UIDS = 'uid-del-capo';
    const { eAdmin } = modulo();
    assert.equal(eAdmin('uid-del-capo'), true);
    assert.equal(eAdmin('uid-di-un-altro'), false);
});

test('l\'elenco accetta piu\' uid, con gli spazi che capitano', () => {
    // Una variabile d'ambiente si incolla a mano: gli spazi intorno alle
    // virgole ci finiscono sempre, e un uid con uno spazio davanti non
    // corrisponderebbe mai a niente — in silenzio.
    process.env.F1_ADMIN_UIDS = ' uno , due,tre ';
    const { eAdmin } = modulo();
    for (const uid of ['uno', 'due', 'tre']) {
        assert.equal(eAdmin(uid), true, `${uid} doveva essere riconosciuto`);
    }
    assert.equal(eAdmin('quattro'), false);
});

test('una stringa vuota fra le virgole non rende admin chi non ha uid', () => {
    // `''.split(',')` su "a,,b" produce una stringa vuota in mezzo: senza il
    // filtro, un uid mancante (ospite, bot) avrebbe corrisposto.
    process.env.F1_ADMIN_UIDS = 'a,,b';
    const { eAdmin, uidAmministratori } = modulo();
    assert.deepEqual(uidAmministratori(), ['a', 'b']);
    assert.equal(eAdmin(''), false);
    assert.equal(eAdmin(null), false);
});
