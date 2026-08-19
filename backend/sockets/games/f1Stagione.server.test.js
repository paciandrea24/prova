// backend/sockets/games/f1Stagione.server.test.js
//
// Il ponte fra una gara finita e il campionato. Due cose da proteggere: che i
// piloti della gara si riconoscano in quelli della stagione (gli umani per
// uid, i bot per colore — l'unica identita' stabile che hanno), e che l'ordine
// d'arrivo diventi punti senza che nessuno li ricalcoli a mano.
const test = require('node:test');
const assert = require('node:assert/strict');
const F1Stagione = require('../../../frontend/shared/f1Stagione.js');
const seasonStore = require('../../store/seasonStore.js');
const ponte = require('./f1Stagione.server.js');

function stagioneFinta() {
    return F1Stagione.creaStagione({
        nome: 'Prova', creataDa: 'uid-andrea',
        piloti: [
            { uid: 'uid-andrea', colore: '#e74c3c', bot: false },
            { uid: null, colore: '#111111', bot: true, nome: 'Bot 1' },
            { uid: null, colore: '#222222', bot: true, nome: 'Bot 2' },
        ],
        calendario: ['monte-rosso', 'new-monza', 'prova'],
        impostazioni: { botsEnabled: true, gridSize: 3 },
    });
}

test('la prossima gara detta pista e griglia alle impostazioni', () => {
    const s = stagioneFinta();
    const settings = ponte.impostazioniPerLaProssimaGara(s, { trackId: 'vecchia', qualcosaDaTenere: 'si' });
    assert.equal(settings.trackId, 'monte-rosso', 'la pista e quella del calendario, non quella di prima');
    assert.equal(String(settings.gridSize), '3');
    assert.equal(settings.formato, 'stagione');
    assert.equal(settings.stagioneInCorso, true, 'la pagina che riparte deve sapere che si CORRE, non che si sceglie');
    assert.equal(settings.qualcosaDaTenere, 'si', 'il resto delle impostazioni non si butta');
    // I bot viaggiano nelle impostazioni: createBots e' sincrona e non puo'
    // aspettare Mongo nel mezzo di un join.
    assert.deepEqual(settings.botStagione, [
        { colore: '#111111', nome: 'Bot 1' },
        { colore: '#222222', nome: 'Bot 2' },
    ]);
});

test('a stagione finita non c e una prossima gara', () => {
    const s = Object.assign({}, stagioneFinta(), { giro: 3 });
    assert.equal(ponte.impostazioniPerLaProssimaGara(s, {}), null);
});

test('gli umani si riconoscono per uid, i bot per colore', () => {
    const s = stagioneFinta();
    assert.equal(ponte.idPilotaDi(s, { uid: 'uid-andrea', color: '#000000', isBot: false }), 'p1',
        'un umano e il suo uid, anche se in lobby ha cambiato colore');
    assert.equal(ponte.idPilotaDi(s, { uid: null, color: '#222222', isBot: true }), 'p3');
    assert.equal(ponte.idPilotaDi(s, { uid: 'uid-estraneo', color: '#999999', isBot: false }), null);
});

test('l ordine del podio diventa l ordine dei piloti della stagione', () => {
    const s = stagioneFinta();
    const podium = [
        { color: '#111111', uid: null, isBot: true },
        { color: '#e74c3c', uid: 'uid-andrea', isBot: false },
        { color: '#222222', uid: null, isBot: true },
    ];
    assert.deepEqual(ponte.ordineDelPodio(s, podium), ['p2', 'p1', 'p3']);
});

test('un pilota estraneo alla stagione non fa cadere il risultato degli altri', () => {
    const s = stagioneFinta();
    const podium = [
        { color: '#e74c3c', uid: 'uid-andrea', isBot: false },
        { color: '#999999', uid: 'uid-intruso', isBot: false },   // non e' di questa stagione
        { color: '#111111', uid: null, isBot: true },
    ];
    assert.deepEqual(ponte.ordineDelPodio(s, podium), ['p1', 'p2'],
        'l intruso si salta, gli altri mantengono le loro posizioni relative');
});

test('registrare una gara avanza il calendario e assegna i punti veri', async (t) => {
    t.after(() => seasonStore._svuota());
    const s = await seasonStore.salva(stagioneFinta());
    const podium = [
        { color: '#e74c3c', uid: 'uid-andrea', isBot: false },
        { color: '#111111', uid: null, isBot: true },
        { color: '#222222', uid: null, isBot: true },
    ];

    const dopo = await ponte.registraGara(s, podium);
    assert.equal(dopo.giro, 1, 'si passa alla gara dopo');
    assert.equal(dopo.risultati.length, 1);
    assert.equal(dopo.risultati[0].pista, 'monte-rosso');

    const classifica = F1Stagione.classifica(dopo);
    assert.equal(classifica[0].uid, 'uid-andrea');
    assert.equal(classifica[0].punti, 25);
    assert.equal(classifica[1].punti, 18);

    // E' stata SALVATA, non solo restituita: e' l'unico punto di salvataggio di
    // tutta la stagione, se non scrive qui non scrive mai.
    const riletta = await seasonStore.leggi(s._id);
    assert.equal(riletta.giro, 1);
});

test('una gara di una stagione gia finita non si registra', async (t) => {
    t.after(() => seasonStore._svuota());
    const s = await seasonStore.salva(Object.assign({}, stagioneFinta(), { giro: 3 }));
    await assert.rejects(() => ponte.registraGara(s, []));
});
