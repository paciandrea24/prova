// backend/routes/f1Stagioni.test.js
//
// Le stagioni sono l'unica cosa del gioco legata a un ACCOUNT, e questo file
// protegge la sola regola che conta: dentro un documento ci finisce l'uid
// VERIFICATO dal token, mai quello che il client dichiara. Il resto (elenco,
// lettura, guardia dei "stessi giocatori") discende da li'.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');

const { creaRouter } = require('./f1Stagioni.js');
const seasonStore = require('../store/seasonStore.js');
const { activeGames } = require('../store/activeGames.js');

const LOBBY = 'TESTSTAG';

// Il finto verificatore di token: legge l'uid da un header di comodo. Sta al
// posto di verifyFirebaseToken, che in un test non puo' girare (parla con
// Firebase). E' il motivo per cui il modulo esporta una factory invece di un
// router gia' montato.
function autenticaFinto(req, res, next) {
    const uid = req.headers['x-test-uid'];
    if (!uid) return res.status(401).json({ error: 'Token mancante' });
    req.uid = uid;
    next();
}

function avviaServer() {
    const app = express();
    app.use(express.json());
    app.use('/', creaRouter({ autentica: autenticaFinto }));
    const server = http.createServer(app);
    return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

function chiedi(server, { metodo = 'GET', percorso, uid, corpo }) {
    const { port } = server.address();
    const dati = corpo ? JSON.stringify(corpo) : null;
    const intestazioni = {};
    if (uid) intestazioni['x-test-uid'] = uid;
    if (dati) {
        intestazioni['Content-Type'] = 'application/json';
        intestazioni['Content-Length'] = Buffer.byteLength(dati);
    }
    return new Promise((risolvi, rifiuta) => {
        const req = http.request(
            { host: '127.0.0.1', port, path: percorso, method: metodo, headers: intestazioni },
            (res) => {
                let c = '';
                res.on('data', (p) => { c += p; });
                res.on('end', () => {
                    let d = null;
                    try { d = JSON.parse(c); } catch (e) { /* non JSON */ }
                    risolvi({ stato: res.statusCode, dati: d });
                });
            }
        );
        req.on('error', rifiuta);
        if (dati) req.write(dati);
        req.end();
    });
}

// Una partita F1 finta: alla rotta servono solo i piloti e il loro uid.
function preparaPartita(giocatori) {
    const players = {};
    for (const g of giocatori) {
        players[g.colore] = { color: g.colore, uid: g.uid || null, isBot: !!g.bot };
    }
    activeGames.set(LOBBY, { gameId: 'f1', players, gridSize: 6, settings: {} });
}

function pulisci() {
    activeGames.delete(LOBBY);
    seasonStore._svuota();
}

test('creare una stagione: chi la crea e i suoi compagni li dice la PARTITA, non il client', async (t) => {
    t.after(pulisci);
    const server = await avviaServer();
    t.after(() => server.close());
    preparaPartita([{ colore: '#e74c3c', uid: 'uid-andrea' }, { colore: '#3498db', uid: 'uid-amico' }]);

    const r = await chiedi(server, {
        metodo: 'POST', percorso: '/api/f1/stagioni', uid: 'uid-andrea',
        // L'intruso: il client prova a dichiarare i piloti di suo pugno.
        corpo: { lobbyId: LOBBY, nome: 'Mondiale', quanteGare: 3, gridSize: 4, piloti: [{ uid: 'uid-estraneo' }] },
    });

    assert.equal(r.stato, 201);
    const s = r.dati.stagione;
    assert.equal(s.creataDa, 'uid-andrea', 'chi crea e\' l\'uid del TOKEN');
    const umani = s.piloti.filter(p => !p.bot).map(p => p.uid).sort();
    assert.deepEqual(umani, ['uid-amico', 'uid-andrea'],
        'i piloti umani sono quelli della partita; quelli dichiarati dal client si ignorano');
    assert.equal(s.piloti.length, 4, 'la griglia si riempie di bot fino a gridSize');
    assert.ok(s.piloti.filter(p => p.bot).every(p => p.colore && p.nome),
        'ogni bot ha colore e nome stabili');
});

test('il calendario ha N piste distinte e la stagione parte dal giro 0', async (t) => {
    t.after(pulisci);
    const server = await avviaServer();
    t.after(() => server.close());
    preparaPartita([{ colore: '#e74c3c', uid: 'uid-andrea' }]);

    const r = await chiedi(server, {
        metodo: 'POST', percorso: '/api/f1/stagioni', uid: 'uid-andrea',
        corpo: { lobbyId: LOBBY, nome: 'Solitario', quanteGare: 3, gridSize: 6 },
    });

    const s = r.dati.stagione;
    assert.equal(s.calendario.length, 3);
    assert.equal(new Set(s.calendario).size, 3, 'una pista non si ripete');
    assert.equal(s.giro, 0);
    assert.deepEqual(s.risultati, []);
});

test('senza token non si crea niente', async (t) => {
    t.after(pulisci);
    const server = await avviaServer();
    t.after(() => server.close());
    preparaPartita([{ colore: '#e74c3c', uid: 'uid-andrea' }]);

    const r = await chiedi(server, {
        metodo: 'POST', percorso: '/api/f1/stagioni',
        corpo: { lobbyId: LOBBY, nome: 'Abusiva', quanteGare: 3, gridSize: 6 },
    });
    assert.equal(r.stato, 401);
});

test('non si crea una stagione dentro la partita di qualcun altro', async (t) => {
    t.after(pulisci);
    const server = await avviaServer();
    t.after(() => server.close());
    preparaPartita([{ colore: '#e74c3c', uid: 'uid-andrea' }]);

    const r = await chiedi(server, {
        metodo: 'POST', percorso: '/api/f1/stagioni', uid: 'uid-estraneo',
        corpo: { lobbyId: LOBBY, nome: 'Non mia', quanteGare: 3, gridSize: 6 },
    });
    assert.equal(r.stato, 403);
});

test('l\'elenco porta le stagioni in cui CORRO, non solo quelle che ho creato', async (t) => {
    t.after(pulisci);
    const server = await avviaServer();
    t.after(() => server.close());
    preparaPartita([{ colore: '#e74c3c', uid: 'uid-andrea' }, { colore: '#3498db', uid: 'uid-amico' }]);
    await chiedi(server, {
        metodo: 'POST', percorso: '/api/f1/stagioni', uid: 'uid-andrea',
        corpo: { lobbyId: LOBBY, nome: 'Nostra', quanteGare: 3, gridSize: 4 },
    });

    const mie = await chiedi(server, { percorso: '/api/f1/stagioni', uid: 'uid-amico' });
    assert.equal(mie.stato, 200);
    assert.equal(mie.dati.stagioni.length, 1, 'l\'amico non l\'ha creata ma ci corre');
    assert.equal(mie.dati.stagioni[0].nome, 'Nostra');

    const estraneo = await chiedi(server, { percorso: '/api/f1/stagioni', uid: 'uid-estraneo' });
    assert.deepEqual(estraneo.dati.stagioni, [], 'chi non ci corre non la vede');
});

test('una stagione si legge solo se ci corri dentro', async (t) => {
    t.after(pulisci);
    const server = await avviaServer();
    t.after(() => server.close());
    preparaPartita([{ colore: '#e74c3c', uid: 'uid-andrea' }]);
    const creata = await chiedi(server, {
        metodo: 'POST', percorso: '/api/f1/stagioni', uid: 'uid-andrea',
        corpo: { lobbyId: LOBBY, nome: 'Mia', quanteGare: 3, gridSize: 6 },
    });
    const id = creata.dati.stagione._id;

    assert.equal((await chiedi(server, { percorso: '/api/f1/stagioni/' + id, uid: 'uid-andrea' })).stato, 200);
    assert.equal((await chiedi(server, { percorso: '/api/f1/stagioni/' + id, uid: 'uid-estraneo' })).stato, 404);
});

test('quante gare: sotto il minimo o sopra le piste disponibili e\' un rifiuto, non un silenzioso aggiustamento', async (t) => {
    t.after(pulisci);
    const server = await avviaServer();
    t.after(() => server.close());
    preparaPartita([{ colore: '#e74c3c', uid: 'uid-andrea' }]);

    const troppoPoche = await chiedi(server, {
        metodo: 'POST', percorso: '/api/f1/stagioni', uid: 'uid-andrea',
        corpo: { lobbyId: LOBBY, nome: 'Corta', quanteGare: 1, gridSize: 6 },
    });
    assert.equal(troppoPoche.stato, 400);
    assert.match(String(troppoPoche.dati.error), /gare/i);

    const troppe = await chiedi(server, {
        metodo: 'POST', percorso: '/api/f1/stagioni', uid: 'uid-andrea',
        corpo: { lobbyId: LOBBY, nome: 'Infinita', quanteGare: 999, gridSize: 6 },
    });
    assert.equal(troppe.stato, 400);
});

test("riprendere una stagione con i giocatori sbagliati si puo' vedere ma non fare", async (t) => {
    t.after(pulisci);
    const server = await avviaServer();
    t.after(() => server.close());
    preparaPartita([{ colore: '#e74c3c', uid: 'uid-andrea' }, { colore: '#3498db', uid: 'uid-amico' }]);
    const creata = await chiedi(server, {
        metodo: 'POST', percorso: '/api/f1/stagioni', uid: 'uid-andrea',
        corpo: { lobbyId: LOBBY, nome: 'In due', quanteGare: 3, gridSize: 4 },
    });
    const id = creata.dati.stagione._id;

    // L'amico se ne va: in pista resta solo Andrea.
    preparaPartita([{ colore: '#e74c3c', uid: 'uid-andrea' }]);

    const r = await chiedi(server, { percorso: `/api/f1/stagioni/${id}?lobbyId=${LOBBY}`, uid: 'uid-andrea' });
    assert.equal(r.stato, 200, 'la stagione si deve poter APRIRE: si vede che esiste');
    assert.equal(r.dati.ripresa.ok, false);
    assert.deepEqual(r.dati.ripresa.mancanti, ['uid-amico'], 'e deve dire CHI manca');
});

test('con gli stessi giocatori la stagione e ripartibile', async (t) => {
    t.after(pulisci);
    const server = await avviaServer();
    t.after(() => server.close());
    preparaPartita([{ colore: '#e74c3c', uid: 'uid-andrea' }]);
    const creata = await chiedi(server, {
        metodo: 'POST', percorso: '/api/f1/stagioni', uid: 'uid-andrea',
        corpo: { lobbyId: LOBBY, nome: 'Da solo', quanteGare: 3, gridSize: 4 },
    });
    const id = creata.dati.stagione._id;

    const r = await chiedi(server, { percorso: `/api/f1/stagioni/${id}?lobbyId=${LOBBY}`, uid: 'uid-andrea' });
    assert.equal(r.dati.ripresa.ok, true);
    assert.deepEqual(r.dati.ripresa.mancanti, []);
    assert.deepEqual(r.dati.ripresa.inPiu, []);
});

test('quanti piloti si corre decide QUALI piste entrano in calendario', async (t) => {
    // Non un tetto di piloti: un filtro sulle piste. Una corsia box corta non
    // ospita venti box, quindi con venti piloti quella pista non si corre — ma
    // non impedisce di correre il campionato altrove. La strada opposta (tetto
    // pari alla pista piu' stretta) rendeva impossibile QUALUNQUE campionato
    // appena esisteva una pista stretta, e le piste le disegna l'utente.
    //
    // L'invariante e' verificata SUL RISULTATO e non su un elenco letto a
    // parte: la cartella delle piste puo' cambiare sotto i piedi mentre i test
    // girano (trackLoader.test.js ne crea una temporanea), e un test che
    // confronta due fotografie prese in due istanti diversi e' instabile per
    // costruzione.
    t.after(pulisci);
    const server = await avviaServer();
    t.after(() => server.close());
    preparaPartita([{ colore: '#e74c3c', uid: 'uid-andrea' }]);

    const { listTracks } = require('../sockets/games/trackLoader.js');
    const PILOTI = 14;

    const r = await chiedi(server, {
        metodo: 'POST', percorso: '/api/f1/stagioni', uid: 'uid-andrea',
        corpo: { lobbyId: LOBBY, nome: 'Griglia larga', quanteGare: 3, gridSize: PILOTI },
    });

    if (r.stato === 201) {
        const capienza = new Map(listTracks().map(t => [t.id, t.maxDrivers || 20]));
        for (const id of r.dati.stagione.calendario) {
            assert.ok((capienza.get(id) || 20) >= PILOTI,
                `${id} non ha i box per ${PILOTI} piloti: non puo' stare in calendario`);
        }
    } else {
        // Poche piste adatte: si rifiuta dicendo i numeri, non si accorcia il
        // calendario di nascosto.
        assert.equal(r.stato, 400);
        assert.match(String(r.dati.error), /piloti/i);
    }
});

test('sei piloti restano possibili anche se esiste una pista stretta', async (t) => {
    // La regressione che ha fatto cambiare disegno: una pista di prova con la
    // corsia box minima (la crea trackLoader.test.js) faceva rifiutare perfino
    // la griglia piu' piccola.
    t.after(pulisci);
    const server = await avviaServer();
    t.after(() => server.close());
    preparaPartita([{ colore: '#e74c3c', uid: 'uid-andrea' }]);

    const r = await chiedi(server, {
        metodo: 'POST', percorso: '/api/f1/stagioni', uid: 'uid-andrea',
        corpo: { lobbyId: LOBBY, nome: 'Piccola', quanteGare: 3, gridSize: 6 },
    });
    assert.equal(r.stato, 201, r.dati && r.dati.error);
    assert.equal(r.dati.stagione.piloti.length, 6);
});
