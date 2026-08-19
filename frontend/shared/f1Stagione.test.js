// frontend/shared/f1Stagione.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./f1Stagione');

// Un generatore prevedibile: senza, un test sul sorteggio o è fragile o non
// si scrive proprio.
function rngFinto(valori) {
    let i = 0;
    return () => valori[i++ % valori.length];
}

const PILOTI = [
    { uid: 'u-andrea', colore: '#e74c3c' },
    { uid: null, bot: true, colore: '#3498db', nome: 'Bot 1' },
    { uid: null, bot: true, colore: '#2ecc71', nome: 'Bot 2' },
];

function stagioneDiProva(calendario = ['a', 'b', 'c']) {
    return S.creaStagione({
        nome: 'Prova', creataDa: 'u-andrea', piloti: PILOTI,
        calendario, impostazioni: { gridSize: 6 }, adesso: '2026-08-19T00:00:00Z',
    });
}

// ---- il calendario ----------------------------------------------------------

test('il calendario non ripete mai una pista', () => {
    const piste = ['monte-rosso', 'new-monza', 'prova', 'prova-notturno'];
    for (let n = 1; n <= piste.length; n++) {
        const c = S.sorteggiaCalendario(piste, n);
        assert.equal(c.length, n);
        assert.equal(new Set(c).size, n, `${n} gare ma solo ${new Set(c).size} piste diverse`);
        for (const p of c) assert.ok(piste.includes(p), `pista inventata: ${p}`);
    }
});

test('chiedere piu gare delle piste da una stagione piu corta, non una pista ripetuta', () => {
    // È la richiesta dell'utente: niente varianti, niente ripetizioni. Meglio
    // un campionato corto di uno che passa due volte dallo stesso posto.
    const c = S.sorteggiaCalendario(['a', 'b'], 10);
    assert.equal(c.length, 2);
    assert.equal(new Set(c).size, 2);
});

test('il sorteggio mescola davvero, e con lo stesso rng da lo stesso calendario', () => {
    const piste = ['a', 'b', 'c', 'd', 'e'];
    const uno = S.sorteggiaCalendario(piste, 5, rngFinto([0.9, 0.1, 0.7, 0.3, 0.5]));
    const due = S.sorteggiaCalendario(piste, 5, rngFinto([0.9, 0.1, 0.7, 0.3, 0.5]));
    assert.deepEqual(uno, due, 'stesso rng, calendario diverso: non e riproducibile');
    assert.notDeepEqual(uno, piste, 'il sorteggio ha restituito l ordine di partenza');
});

test('l intervallo delle gare non e legato al numero totale di piste', () => {
    // Il senso della richiesta: con 40 piste una stagione NON deve essere di
    // 40 gare per forza. 40 e' il tetto, non la lunghezza.
    const con40 = S.intervalloGare(40);
    assert.equal(con40.max, 40);
    assert.ok(con40.consigliate < 40, 'con 40 piste consiglia comunque 40 gare');
    assert.ok(con40.consigliate >= con40.min);

    // Con poche piste il minimo si abbassa invece di rendere impossibile
    // creare una stagione.
    const con2 = S.intervalloGare(2);
    assert.equal(con2.max, 2);
    assert.ok(con2.min <= 2, 'con 2 piste il minimo resta 3 e non si puo creare niente');
    assert.ok(con2.consigliate <= 2);
});

// ---- i punti ----------------------------------------------------------------

test('i punti sono quelli veri e finiscono al decimo', () => {
    assert.equal(S.puntiPerPosizione(1), 25);
    assert.equal(S.puntiPerPosizione(2), 18);
    assert.equal(S.puntiPerPosizione(10), 1);
    assert.equal(S.puntiPerPosizione(11), 0);
    assert.equal(S.puntiPerPosizione(99), 0);
});

// ---- la stagione ------------------------------------------------------------

test('alla creazione ogni pilota riceve un id stabile, bot compresi', () => {
    const s = stagioneDiProva();
    const ids = s.piloti.map(p => p.id);
    assert.equal(new Set(ids).size, ids.length, 'due piloti con lo stesso id');
    assert.ok(s.piloti.every(p => typeof p.id === 'string' && p.id.length));
    // I bot non hanno uid: se l'identita fosse l'uid non esisterebbero in
    // classifica, e in singolo non ci sarebbe nessun campionato.
    assert.equal(s.piloti[1].uid, null);
    assert.equal(s.piloti[1].bot, true);
});

test('registrare un risultato avanza il calendario e NON muta l originale', () => {
    const s = stagioneDiProva();
    assert.equal(S.garaCorrente(s), 'a');
    const dopo = S.registraRisultato(s, { ordine: ['p1', 'p2', 'p3'] });
    assert.equal(S.garaCorrente(dopo), 'b');
    assert.equal(dopo.risultati.length, 1);
    assert.equal(dopo.risultati[0].pista, 'a');
    // L'originale intatto: chi salva su Mongo deve poter fallire senza aver
    // gia sporcato l'oggetto in memoria.
    assert.equal(s.giro, 0);
    assert.equal(s.risultati.length, 0);
});

test('la stagione finisce quando il calendario e esaurito', () => {
    let s = stagioneDiProva(['a', 'b']);
    assert.equal(S.finita(s), false);
    s = S.registraRisultato(s, { ordine: ['p1', 'p2', 'p3'] });
    assert.equal(S.finita(s), false);
    s = S.registraRisultato(s, { ordine: ['p2', 'p1', 'p3'] });
    assert.equal(S.finita(s), true);
    assert.equal(S.garaCorrente(s), null);
    assert.throws(() => S.registraRisultato(s, { ordine: ['p1'] }), /finita/);
});

// ---- la classifica ----------------------------------------------------------

test('la classifica somma i punti di tutte le gare, bot compresi', () => {
    let s = stagioneDiProva(['a', 'b']);
    s = S.registraRisultato(s, { ordine: ['p1', 'p2', 'p3'] });   // 25 / 18 / 15
    s = S.registraRisultato(s, { ordine: ['p2', 'p3', 'p1'] });   // p2 25, p3 18, p1 15
    const c = S.classifica(s);
    const punti = Object.fromEntries(c.map(r => [r.id, r.punti]));
    assert.equal(punti.p1, 25 + 15);
    assert.equal(punti.p2, 18 + 25);
    assert.equal(punti.p3, 15 + 18);
    assert.equal(c[0].id, 'p2', 'in testa deve esserci chi ha piu punti');
    assert.deepEqual(c.map(r => r.posizione), [1, 2, 3]);
});

test('chi non ha ancora corso compare a zero, non sparisce', () => {
    const c = S.classifica(stagioneDiProva());
    assert.equal(c.length, 3);
    assert.ok(c.every(r => r.punti === 0 && r.gare === 0));
});

test('a pari punti vince chi ha i piazzamenti migliori', () => {
    // Due piloti a 43 punti: uno con una vittoria e un terzo posto, l'altro
    // con due secondi. In F1 vera vince il primo. Senza questa regola il
    // campione lo deciderebbe l'ordine in cui e scritto un ciclo.
    let s = stagioneDiProva(['a', 'b']);
    s = S.registraRisultato(s, { ordine: ['p1', 'p2', 'p3'] });   // p1 25, p2 18, p3 15
    s = S.registraRisultato(s, { ordine: ['p3', 'p2', 'p1'] });   // p3 25, p2 18, p1 15
    const c = S.classifica(s);
    assert.equal(c[0].punti, 40);
    assert.equal(c[1].punti, 40);
    assert.equal(c[2].id, 'p2', 'p2 ha 36 punti e deve stare sotto');
    // p1 e p3 hanno entrambi una vittoria e un terzo posto: indistinguibili,
    // e l'ordine deve almeno essere STABILE.
    const ancora = S.classifica(s);
    assert.deepEqual(ancora.map(r => r.id), c.map(r => r.id));
});

test('a pari punti, chi ha vinto una gara sta davanti a chi non ne ha vinta nessuna', () => {
    // Il caso che decide un campionato. p1 vince e poi arriva sesto; p2 fa un
    // secondo e un terzo. Sono 33 punti a testa (25+8 e 18+15), ma p1 una gara
    // l'ha vinta e p2 no. Senza il countback davanti ci finirebbe chi capita.
    let s = S.creaStagione({
        nome: 'x', calendario: ['a', 'b'],
        piloti: [{ uid: 'a' }, { uid: 'b' }, { bot: true }, { bot: true }, { bot: true }, { bot: true }],
    });
    s = S.registraRisultato(s, { ordine: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'] });
    s = S.registraRisultato(s, { ordine: ['p3', 'p4', 'p2', 'p5', 'p6', 'p1'] });

    const c = S.classifica(s);
    const p1 = c.find(r => r.id === 'p1'), p2 = c.find(r => r.id === 'p2');
    assert.equal(p1.punti, 33);
    assert.equal(p2.punti, 33);
    assert.equal(S.vittorie(p1), 1);
    assert.equal(S.vittorie(p2), 0);
    assert.ok(p1.posizione < p2.posizione,
        `a pari punti p1 ha una vittoria e deve stare davanti: p1 ${p1.posizione}, p2 ${p2.posizione}`);
});

test('un id sconosciuto nei risultati non fa cadere la classifica', () => {
    let s = stagioneDiProva(['a']);
    s = S.registraRisultato(s, { ordine: ['p1', 'FANTASMA', 'p2'] });
    const c = S.classifica(s);
    assert.equal(c.length, 3, 'la classifica deve restare quella dei piloti veri');
    // p2 era terzo nell'ordine, quindi prende i punti del TERZO posto: il
    // fantasma occupa comunque una posizione, non la si richiude.
    assert.equal(c.find(r => r.id === 'p2').punti, 15);
});

// ---- riprendere -------------------------------------------------------------

test('si riprende solo con esattamente gli stessi giocatori', () => {
    const s = S.creaStagione({
        nome: 'x', piloti: [{ uid: 'a' }, { uid: 'b' }, { bot: true }], calendario: ['t'],
    });
    assert.equal(S.siPuoRiprendere(s, ['a', 'b']).ok, true);

    const senzaB = S.siPuoRiprendere(s, ['a']);
    assert.equal(senzaB.ok, false);
    assert.deepEqual(senzaB.mancanti, ['b']);

    const conC = S.siPuoRiprendere(s, ['a', 'b', 'c']);
    assert.equal(conC.ok, false, 'uno in piu non avrebbe ne posto in griglia ne punti pregressi');
    assert.deepEqual(conC.inPiu, ['c']);
});

test('i bot non contano fra i giocatori attesi', () => {
    const s = S.creaStagione({
        nome: 'x', piloti: [{ uid: 'a' }, { bot: true }, { bot: true }], calendario: ['t'],
    });
    // Da soli con due bot si riprende senza che nessun altro debba esserci.
    assert.equal(S.siPuoRiprendere(s, ['a']).ok, true);
});
