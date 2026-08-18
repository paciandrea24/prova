// backend/sockets/games/f1GameSocket.sequenzaGriglia.test.js
//
// La sequenza fra la fine della qualifica e il semaforo.
//
// Richiesta dell'utente (2026-08-18): "il passaggio tra la fine della
// qualifica e la disposizione in griglia risulta brusco — appena tutti hanno
// finito la qualifica si viene subito catapultati sulla griglia di partenza".
// Al suo posto: stacco a tutto schermo, scoperta della propria posizione,
// riepilogo con la griglia completa e il modello dell'auto in pole.
//
// Qui si protegge il lato server, che è quello che i tre momenti li deve
// tenere insieme: le durate hanno UN proprietario (le costanti SEQ_*), il
// client le riceve invece di tenerne una copia, e il semaforo scatta esattamente
// alla fine del totale — non prima, o l'ultima animazione verrebbe troncata.
const test = require('node:test');
const assert = require('node:assert/strict');
const { lobbies } = require('../../store/lobbies.js');
const { activeGames } = require('../../store/activeGames.js');
const f1 = require('./f1GameSocket.js');

const LOBBY = 'TESTSEQ';

function collega(io, emessi) {
    const handlers = {};
    const socket = {
        id: 'sock-' + Math.random().toString(36).slice(2),
        data: {}, handlers,
        on(ev, cb) { handlers[ev] = cb; },
        emit(ev, dati) { emessi.push({ ev, dati }); },
        join() { },
    };
    f1(io, socket);
    return socket;
}

function prepara(emessi) {
    lobbies.set(LOBBY, {
        host: 'red', players: ['red'], lockedPlayers: ['red'],
        gameSettings: { trackId: 'prova', botsEnabled: 'true', gridSize: '4' },
    });
    const io = { to: () => ({ emit: (ev, dati) => emessi.push({ ev, dati }) }) };
    const s = collega(io, emessi);
    s.handlers.startGame({ lobbyId: LOBBY, gameId: 'f1', settings: lobbies.get(LOBBY).gameSettings });
    s.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'red', uid: 'uid-di-red' });
    return { io, socket: s, game: activeGames.get(LOBBY) };
}

function pulisci() {
    const g = activeGames.get(LOBBY);
    if (g) {
        if (g.tick) clearInterval(g.tick);
        for (const k of ['tyreSelectTimeout', 'qualiEndTimeout', 'endTimeout', 'chiusuraTimeout']) {
            if (g[k]) clearTimeout(g[k]);
        }
        Object.values(g.rejoinTimers || {}).forEach(clearTimeout);
    }
    activeGames.delete(LOBBY);
    lobbies.delete(LOBBY);
}

// Porta la qualifica alla bandiera a scacchi con tempi gia' assegnati.
function chiudiQualifica(io, game) {
    game.phase = 'qualifying';
    let t = 60000;
    for (const p of Object.values(game.players)) { p.finished = true; p.time = (t += 500); }
    f1.endQualifying(io, LOBBY, game);
}

test('f1QualiEnded porta le durate della sequenza, e il totale e la loro somma', (t) => {
    t.after(pulisci);
    const emessi = [];
    const { io, game } = prepara(emessi);
    chiudiQualifica(io, game);

    const ev = emessi.filter(e => e.ev === 'f1QualiEnded').pop();
    assert.ok(ev, 'nessun f1QualiEnded emesso');
    const s = ev.dati.sequenza;
    assert.ok(s, 'l\'evento deve portare le durate: il client non deve tenerne una copia propria');
    for (const k of ['staccoMs', 'posizioneMs', 'poleExtraMs', 'grigliaMs', 'totaleMs']) {
        assert.equal(typeof s[k], 'number', `manca ${k}`);
        assert.ok(s[k] > 0, `${k} non positivo`);
    }
    assert.equal(s.totaleMs, s.staccoMs + s.posizioneMs + s.poleExtraMs + s.grigliaMs,
        'il totale deve essere la somma dei tre momenti: se non lo e, il semaforo tronca l\'ultima animazione');
});

test('la sequenza dura piu del passaggio brusco di prima', (t) => {
    // Il vecchio valore era 8000 ms per animazione POLE + griglia insieme.
    // L'utente ha chiesto esplicitamente piu' respiro, accettando di
    // perderci tempo: se qualcuno riabbassa questo numero senza accorgersene,
    // il passaggio torna quello di prima.
    t.after(pulisci);
    const emessi = [];
    const { io, game } = prepara(emessi);
    chiudiQualifica(io, game);

    const s = emessi.filter(e => e.ev === 'f1QualiEnded').pop().dati.sequenza;
    assert.ok(s.totaleMs > 8000,
        `la sequenza dura ${s.totaleMs} ms, non piu' del passaggio brusco di prima (8000)`);
});

test('la griglia porta uid e isBot: servono al modello dell auto in pole', (t) => {
    t.after(pulisci);
    const emessi = [];
    const { io, game } = prepara(emessi);
    chiudiQualifica(io, game);

    const griglia = emessi.filter(e => e.ev === 'f1QualiEnded').pop().dati.grid;
    assert.ok(griglia.length > 1, 'servono anche i bot per questo test');
    for (const riga of griglia) {
        assert.ok('color' in riga && 'time' in riga && 'uid' in riga && 'isBot' in riga,
            `riga incompleta: ${JSON.stringify(riga)}`);
    }
    const umano = griglia.find(r => r.color === 'red');
    assert.equal(umano.uid, 'uid-di-red', 'senza uid il riepilogo non puo chiedere la livrea personalizzata');
    assert.equal(umano.isBot, false);
    assert.ok(griglia.some(r => r.isBot === true), 'i bot devono essere marcati come tali');
});

test('il semaforo scatta alla FINE della sequenza, non prima', (t) => {
    t.after(pulisci);
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const emessi = [];
    const { io, game } = prepara(emessi);
    chiudiQualifica(io, game);
    const s = emessi.filter(e => e.ev === 'f1QualiEnded').pop().dati.sequenza;

    const contoAllaRovescia = () => emessi.filter(e => e.ev === 'f1Countdown' && e.dati.phase === 'race');

    t.mock.timers.tick(s.totaleMs - 50);
    assert.equal(contoAllaRovescia().length, 0,
        'il semaforo e scattato mentre il riepilogo era ancora a schermo');

    t.mock.timers.tick(100);
    assert.equal(contoAllaRovescia().length, 1,
        'il semaforo non e scattato alla fine della sequenza');
});
