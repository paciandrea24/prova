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

// ---- il riepilogo di fine gara ----------------------------------------------

test('la classifica si puo fermare a una gara indietro', () => {
    // E' quello che serve per mostrare "com'era prima" accanto a "com'e
    // adesso": la stessa somma, fermata un passo prima. Se fosse un secondo
    // calcolo, i due totali potrebbero divergere.
    let s = stagioneDiProva(['a', 'b']);
    s = S.registraRisultato(s, { ordine: ['p1', 'p2', 'p3'] });
    s = S.registraRisultato(s, { ordine: ['p3', 'p2', 'p1'] });

    const prima = S.classifica(s, { fermaA: 1 });
    assert.equal(prima.find(r => r.id === 'p1').punti, 25);
    assert.equal(prima.find(r => r.id === 'p3').punti, 15);
    assert.equal(prima.find(r => r.id === 'p1').gare, 1);

    const zero = S.classifica(s, { fermaA: 0 });
    assert.ok(zero.every(r => r.punti === 0), 'fermata a zero gare deve essere tutta a zero');

    // Oltre il numero di gare corse e' come non fermarla affatto.
    assert.deepEqual(S.classifica(s, { fermaA: 99 }), S.classifica(s));
});

test('il riepilogo dice quanti punti ha preso ognuno in QUELLA gara', () => {
    let s = stagioneDiProva(['a', 'b']);
    s = S.registraRisultato(s, { ordine: ['p1', 'p2', 'p3'] });
    s = S.registraRisultato(s, { ordine: ['p3', 'p2', 'p1'] });

    const r = S.riepilogoGara(s, 1);
    assert.equal(r.pista, 'b');
    assert.equal(r.numero, 2);
    assert.equal(r.totale, 2);
    assert.deepEqual(r.arrivo.map(x => x.id), ['p3', 'p2', 'p1']);
    assert.deepEqual(r.arrivo.map(x => x.posizione), [1, 2, 3]);
    assert.deepEqual(r.arrivo.map(x => x.puntiPresi), [25, 18, 15]);
    // I dati del pilota viaggiano con la riga: chi disegna non deve andarseli
    // a cercare nell'elenco dei piloti.
    assert.equal(r.arrivo[0].colore, '#2ecc71');
    assert.equal(r.arrivo[0].bot, true);
});

test('il riepilogo porta la classifica prima e dopo, col movimento', () => {
    let s = stagioneDiProva(['a', 'b']);
    s = S.registraRisultato(s, { ordine: ['p1', 'p2', 'p3'] });   // p1 25, p2 18, p3 15
    s = S.registraRisultato(s, { ordine: ['p3', 'p2', 'p1'] });   // p3 +25, p2 +18, p1 +15

    const r = S.riepilogoGara(s, 1);
    // Prima: p1 primo, p2 secondo, p3 terzo. Dopo: p1 e p3 a 40, p2 a 36.
    assert.deepEqual(r.prima.map(x => x.id), ['p1', 'p2', 'p3']);
    const dopo = Object.fromEntries(r.dopo.map(x => [x.id, x]));
    assert.equal(dopo.p3.puntiPresi, 25);
    assert.equal(dopo.p3.punti, 40);
    assert.equal(dopo.p3.posizionePrima, 3);
    assert.equal(dopo.p3.movimento, 1, 'p3 e salito dal terzo al secondo posto');
    assert.equal(dopo.p2.movimento, -1, 'p2 e sceso dal secondo al terzo');
    assert.equal(dopo.p1.movimento, 0);
    // Chi non e' arrivato in quella gara non guadagna punti, e va detto con
    // uno zero e non con un buco: la riga si disegna comunque.
    const s3 = S.registraRisultato(stagioneDiProva(['a']), { ordine: ['p1', 'p2'] });
    const soloDue = S.riepilogoGara(s3, 0);
    assert.equal(soloDue.dopo.find(x => x.id === 'p3').puntiPresi, 0);
});

test('alla prima gara il riepilogo non inventa movimenti', () => {
    // Prima della prima gara non esiste una classifica: sono tutti a zero, e
    // l'ordine e' solo quello in cui i piloti sono scritti. Mostrare frecce
    // rispetto a quello vorrebbe dire raccontare scalate che non sono
    // avvenute.
    const s = S.registraRisultato(stagioneDiProva(), { ordine: ['p3', 'p1', 'p2'] });
    const r = S.riepilogoGara(s, 0);
    assert.equal(r.primaGara, true);
    assert.ok(r.dopo.every(x => x.movimento === 0), 'alla prima gara nessuno si e mosso');
    // E nemmeno "veniva da" un posto diverso: chi disegna usa questo numero
    // per far scorrere le righe, e un valore qualunque le farebbe scorrere da
    // un ordine che non ha mai voluto dire niente.
    assert.ok(r.dopo.every(x => x.posizionePrima === x.posizione),
        'alla prima gara le righe partirebbero da posizioni inventate');
});

test('un riepilogo di una gara non ancora corsa non esiste', () => {
    const s = stagioneDiProva(['a', 'b']);
    assert.equal(S.riepilogoGara(s, 0), null);
    assert.equal(S.riepilogoGara(s, -1), null);
    assert.equal(S.riepilogoGara(null, 0), null);
});

// ---- da quale gara si torna -------------------------------------------------

test('il riepilogo si mostra solo se il segno e di QUESTA stagione e di QUELLA gara', () => {
    let s = stagioneDiProva(['a', 'b']);
    s = S.registraRisultato(s, { ordine: ['p1', 'p2', 'p3'] });
    s._id = 'S1';

    assert.equal(S.garaDaRiepilogare(s, { stagioneId: 'S1', pista: 'a' }), 0);
    // Una stagione diversa: il segno e' di un'altra partita rimasta in giro.
    assert.equal(S.garaDaRiepilogare(s, { stagioneId: 'ALTRA', pista: 'a' }), null);
    // La pista non coincide: vuol dire che il risultato di quella gara NON e'
    // stato registrato, e l'ultimo che c'e' e' di una gara precedente. Meglio
    // nessun riepilogo che il riepilogo di una gara che non hai appena corso.
    assert.equal(S.garaDaRiepilogare(s, { stagioneId: 'S1', pista: 'b' }), null);
    assert.equal(S.garaDaRiepilogare(s, null), null);
    // Nessuna gara corsa: non c'e' niente da riepilogare.
    const vuota = Object.assign(stagioneDiProva(), { _id: 'S1' });
    assert.equal(S.garaDaRiepilogare(vuota, { stagioneId: 'S1', pista: 'a' }), null);
});

// ---- la fine della stagione -------------------------------------------------

test('l albo dice chi e campione e con quanto margine', () => {
    let s = stagioneDiProva(['a', 'b']);
    s = S.registraRisultato(s, { ordine: ['p1', 'p2', 'p3'] });   // 25 / 18 / 15
    s = S.registraRisultato(s, { ordine: ['p1', 'p3', 'p2'] });   // 25 / 18 / 15
    const albo = S.albo(s);
    assert.equal(albo.campione.id, 'p1');
    assert.equal(albo.campione.punti, 50);
    assert.equal(albo.gare, 2);
    // p2 ha 18+15=33, p3 ha 15+18=33: il margine e sul SECONDO, chiunque sia.
    assert.equal(albo.margine, 50 - 33);
    assert.deepEqual(albo.classifica.map(r => r.id), S.classifica(s).map(r => r.id));
});

test('i numeri di un pilota: gare, vittorie, podi, miglior arrivo', () => {
    let s = S.creaStagione({
        nome: 'x', calendario: ['a', 'b', 'c'],
        piloti: [{ uid: 'u' }, { bot: true }, { bot: true }, { bot: true }],
    });
    s = S.registraRisultato(s, { ordine: ['p1', 'p2', 'p3', 'p4'] });   // 1o
    s = S.registraRisultato(s, { ordine: ['p2', 'p3', 'p1', 'p4'] });   // 3o
    s = S.registraRisultato(s, { ordine: ['p2', 'p3', 'p4', 'p1'] });   // 4o

    const n = S.numeriDi(s, 'p1');
    assert.equal(n.gare, 3);
    assert.equal(n.vittorie, 1);
    assert.equal(n.podi, 2, 'primo e terzo posto sono due podi');
    assert.equal(n.punti, 25 + 15 + 12);
    assert.equal(n.miglioreArrivo, 1);

    // Un pilota che non ha mai corso non ha un "miglior arrivo" da mostrare:
    // uno zero li' verrebbe letto come una posizione.
    const mai = S.numeriDi(stagioneDiProva(), 'p1');
    assert.equal(mai.gare, 0);
    assert.equal(mai.miglioreArrivo, null);
});

test('la cronaca racconta le gare in ordine, con la classifica di quel momento', () => {
    let s = stagioneDiProva(['a', 'b']);
    s = S.registraRisultato(s, { ordine: ['p2', 'p1', 'p3'] });
    s = S.registraRisultato(s, { ordine: ['p1', 'p3', 'p2'] });

    const c = S.cronaca(s);
    assert.equal(c.length, 2, 'una voce per ogni gara CORSA, non per ogni tappa in calendario');
    assert.deepEqual(c.map(x => x.numero), [1, 2]);
    assert.deepEqual(c.map(x => x.pista), ['a', 'b']);
    assert.equal(c[0].vincitore.id, 'p2');
    assert.equal(c[1].vincitore.id, 'p1');
    // Dopo la prima gara comanda p2; alla fine comanda p1. E' il duello che le
    // barre devono raccontare: senza la classifica PROGRESSIVA non si vede.
    assert.equal(c[0].classifica[0].id, 'p2');
    assert.deepEqual(c[1].classifica.map(r => r.id), S.classifica(s).map(r => r.id));
    // Una stagione senza gare corse non ha niente da raccontare.
    assert.deepEqual(S.cronaca(stagioneDiProva()), []);
});

// ---- Il parco chiuso: lo stato della vettura si CALCOLA ---------------------
// Stesso principio già scritto sopra per la classifica: nel documento stanno
// gli EVENTI, non i totali. Un'usura salvata accanto agli eventi sarebbe un
// secondo posto dove vive la stessa verità.
// Rif. docs/superpowers/specs/2026-08-23-f1-economia-della-gara-design.md
//
// Il nome per esteso è quello con cui queste regole girano nel resto del
// progetto: qui sotto si legge come nel codice che le usa.
const F1Stagione = S;

function stagioneDaDueGare() {
    return F1Stagione.creaStagione({
        nome: 'Parco chiuso', creataDa: 'uid-a',
        piloti: [{ uid: 'uid-a', colore: 'red' }, { colore: 'blue', bot: true }],
        calendario: ['prova', 'new-monza', 'monte-rosso'],
        adesso: '2026-08-23T00:00:00.000Z',
    });
}

test('statoVettura: prima di ogni gara la macchina e\' nuova', () => {
    const s = stagioneDaDueGare();
    assert.deepEqual(F1Stagione.statoVettura(s, 'p1'),
        { frontWing: 0, floor: 0, engine: 0, suspension: 0 });
});

test('statoVettura: dopo una gara porta l\'usura di quella gara', () => {
    let s = stagioneDaDueGare();
    s = F1Stagione.registraRisultato(s, {
        ordine: ['p1', 'p2'],
        usura: { p1: { frontWing: 40, floor: 12, engine: 35, suspension: 3 } },
        adesso: '2026-08-23T01:00:00.000Z',
    });
    assert.deepEqual(F1Stagione.statoVettura(s, 'p1'),
        { frontWing: 40, floor: 12, engine: 35, suspension: 3 });
});

test('statoVettura: l\'ultima gara registrata e\' quella che conta, non la somma', () => {
    // L'usura salvata e' gia' il TOTALE alla bandiera, non l'incremento di
    // quella gara: sommarla la conterebbe due volte.
    let s = stagioneDaDueGare();
    s = F1Stagione.registraRisultato(s, {
        ordine: ['p1', 'p2'],
        usura: { p1: { frontWing: 40, floor: 12, engine: 35, suspension: 3 } },
    });
    s = F1Stagione.registraRisultato(s, {
        ordine: ['p1', 'p2'],
        usura: { p1: { frontWing: 10, floor: 20, engine: 70, suspension: 5 } },
    });
    assert.deepEqual(F1Stagione.statoVettura(s, 'p1'),
        { frontWing: 10, floor: 20, engine: 70, suspension: 5 });
});

test('statoVettura: un pilota senza usura registrata resta a zero', () => {
    // Il bot p2 non compare nella mappa: non e' un errore, e' una gara
    // registrata da una versione che l'usura non la scriveva.
    let s = stagioneDaDueGare();
    s = F1Stagione.registraRisultato(s, {
        ordine: ['p1', 'p2'],
        usura: { p1: { frontWing: 40, floor: 12, engine: 35, suspension: 3 } },
    });
    assert.deepEqual(F1Stagione.statoVettura(s, 'p2'),
        { frontWing: 0, floor: 0, engine: 0, suspension: 0 });
});

test('registraRisultato: non muta la stagione che riceve', () => {
    const s = stagioneDaDueGare();
    F1Stagione.registraRisultato(s, { ordine: ['p1', 'p2'], usura: { p1: { engine: 50 } } });
    assert.equal(s.risultati.length, 0, 'l\'originale non si tocca');
});

test('statoVettura: valori fuori scala vengono limitati a 0-100', () => {
    let s = stagioneDaDueGare();
    s = F1Stagione.registraRisultato(s, {
        ordine: ['p1', 'p2'],
        usura: { p1: { frontWing: -5, floor: 250, engine: NaN, suspension: 3 } },
    });
    assert.deepEqual(F1Stagione.statoVettura(s, 'p1'),
        { frontWing: 0, floor: 100, engine: 0, suspension: 3 });
});

// ---- Dotazione, ricambi, penalita' ----------------------------------------
// Il freno alle sostituzioni e' la DOTAZIONE, non la sola penalita': senza,
// la strategia ottima sarebbe banale — riparare sempre tutto e prendersi la
// penalita' sul circuito dove si sorpassa meglio. La domanda diventa QUANDO
// spendere il ricambio, non SE.

function stagioneDaSeiGare() {
    return F1Stagione.creaStagione({
        nome: 'Sei', creataDa: 'uid-a',
        piloti: [{ uid: 'uid-a', colore: 'red' }, { colore: 'blue', bot: true }],
        calendario: ['a', 'b', 'c', 'd', 'e', 'f'],
    });
}

function conUnaGara(s, usura) {
    return F1Stagione.registraRisultato(s, { ordine: ['p1', 'p2'], usura: { p1: usura } });
}

test('dotazione: si calcola dalla lunghezza della stagione', () => {
    // Un numero fisso avrebbe significati diversi su calendari diversi.
    // Su sei gare fa UN ricambio: con un consumo del 18% a gara il motore non
    // arriva in fondo, quindi il ricambio serve — e il secondo si paga.
    assert.equal(F1Stagione.dotazione(stagioneDaSeiGare()).engine, 1);
    const lunga = F1Stagione.creaStagione({
        nome: 'x', creataDa: 'u', piloti: [],
        calendario: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'],
    });
    assert.equal(F1Stagione.dotazione(lunga).engine, 2);
});

test('officinaDaFare: dopo una gara si', () => {
    assert.equal(F1Stagione.officinaDaFare(stagioneDaSeiGare()), false, 'prima della prima gara no');
    const s = conUnaGara(stagioneDaSeiGare(), { engine: 40 });
    assert.equal(F1Stagione.officinaDaFare(s), true);
});

test("officinaDaFare: e' uno STATO, non un momento — si riapre finche' non si decide", () => {
    // Chi chiude il browser in officina la ritrova riaprendo la stagione,
    // senza aver perso la gara appena corsa.
    let s = conUnaGara(stagioneDaSeiGare(), { engine: 40 });
    assert.equal(F1Stagione.officinaDaFare(s), true);
    s = F1Stagione.registraOfficina(s, { ricambi: {} });
    assert.equal(F1Stagione.officinaDaFare(s), false, "nessun ricambio e' comunque una decisione");
});

test('officinaDaFare: a stagione finita non si apre', () => {
    let s = F1Stagione.creaStagione({ nome: 'x', creataDa: 'u', piloti: [{ uid: 'u', colore: 'red' }], calendario: ['a'] });
    s = F1Stagione.registraRisultato(s, { ordine: ['p1'], usura: { p1: { engine: 90 } } });
    assert.equal(F1Stagione.finita(s), true);
    assert.equal(F1Stagione.officinaDaFare(s), false, "non c'e' nessuna gara dopo da preparare");
});

test('registraOfficina: il ricambio azzera il componente', () => {
    let s = conUnaGara(stagioneDaSeiGare(), { floor: 30, engine: 80, suspension: 10 });
    s = F1Stagione.registraOfficina(s, { ricambi: { p1: ['engine'] } });
    const stato = F1Stagione.statoVettura(s, 'p1');
    assert.equal(stato.engine, 0, 'motore nuovo');
    assert.equal(stato.floor, 30, 'il fondo non si tocca');
});

test("registraOfficina: l'ala non e' sostituibile in officina", () => {
    // E' gia' nuova ad ogni via: non ha dotazione e non ha penalita'.
    let s = conUnaGara(stagioneDaSeiGare(), { frontWing: 90, engine: 10 });
    s = F1Stagione.registraOfficina(s, { ricambi: { p1: ['frontWing'] } });
    assert.equal(F1Stagione.penalitaGriglia(s, 'p1'), 0, "nessuna penalita' per l'ala");
    assert.deepEqual(F1Stagione.ricambiUsati(s, 'p1'), { floor: 0, engine: 0, suspension: 0 });
});

test('registraOfficina: due volte sulla stessa gara sostituisce la decisione, non la somma', () => {
    // Riaprire l'officina e cambiare idea non deve consumare due ricambi.
    let s = conUnaGara(stagioneDaSeiGare(), { engine: 80 });
    s = F1Stagione.registraOfficina(s, { ricambi: { p1: ['engine'] } });
    s = F1Stagione.registraOfficina(s, { ricambi: { p1: [] } });
    assert.equal(F1Stagione.ricambiUsati(s, 'p1').engine, 0);
    assert.equal(F1Stagione.statoVettura(s, 'p1').engine, 80, "il motore vecchio e' tornato");
});

test('ricambiRimasti: scalano con l\u0027uso', () => {
    let s = conUnaGara(stagioneDaSeiGare(), { engine: 80 });
    assert.equal(F1Stagione.ricambiRimasti(s, 'p1').engine, 1);
    s = F1Stagione.registraOfficina(s, { ricambi: { p1: ['engine'] } });
    assert.equal(F1Stagione.ricambiRimasti(s, 'p1').engine, 0);
});

test("penalitaGriglia: dentro la dotazione sostituire e' gratis", () => {
    let s = conUnaGara(stagioneDaSeiGare(), { engine: 80 });
    s = F1Stagione.registraOfficina(s, { ricambi: { p1: ['engine'] } });
    assert.equal(F1Stagione.penalitaGriglia(s, 'p1'), 0);
});

test('penalitaGriglia: oltre la dotazione costa posizioni', () => {
    let s = stagioneDaSeiGare();
    // Un motore e' la dotazione su sei gare: il secondo si paga.
    for (let i = 0; i < 2; i++) {
        s = F1Stagione.registraRisultato(s, { ordine: ['p1', 'p2'], usura: { p1: { engine: 90 } } });
        s = F1Stagione.registraOfficina(s, { ricambi: { p1: ['engine'] } });
    }
    assert.equal(F1Stagione.penalitaGriglia(s, 'p1'), F1Stagione.PENALITA_GRIGLIA.engine);
});

test("penalitaGriglia: vale solo per l'ULTIMA officina, non si trascina", () => {
    // Una penalita' gia' scontata non si paga due volte.
    let s = stagioneDaSeiGare();
    for (let i = 0; i < 2; i++) {
        s = F1Stagione.registraRisultato(s, { ordine: ['p1', 'p2'], usura: { p1: { engine: 90 } } });
        s = F1Stagione.registraOfficina(s, { ricambi: { p1: ['engine'] } });
    }
    assert.ok(F1Stagione.penalitaGriglia(s, 'p1') > 0);
    s = F1Stagione.registraRisultato(s, { ordine: ['p1', 'p2'], usura: { p1: { engine: 20 } } });
    s = F1Stagione.registraOfficina(s, { ricambi: {} });
    assert.equal(F1Stagione.penalitaGriglia(s, 'p1'), 0, "la penalita' e' stata scontata");
});

test("penalitaGriglia: piu' ricambi oltre dotazione si sommano", () => {
    let s = stagioneDaSeiGare();
    for (let i = 0; i < 2; i++) {
        s = F1Stagione.registraRisultato(s, { ordine: ['p1', 'p2'], usura: { p1: { engine: 90, floor: 90 } } });
        s = F1Stagione.registraOfficina(s, { ricambi: { p1: ['engine', 'floor'] } });
    }
    assert.equal(F1Stagione.penalitaGriglia(s, 'p1'),
        F1Stagione.PENALITA_GRIGLIA.engine + F1Stagione.PENALITA_GRIGLIA.floor);
});
