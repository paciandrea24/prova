// backend/sockets/games/f1GameSocket.riavvio.test.js
//
// Il tasto "Riavvia" del podio (modalita' singola).
//
// Difetto segnalato in playtest: "la gara ripartiva ma i bot erano tipo oltre
// al traguardo". Riprodotto headless prima di correggere: i bot finivano a ~70
// unita' dalla loro casella mentre il giocatore umano restava a 0.
//
// Causa: `game.raceStarted` NON torna falso alla bandiera a scacchi (chi ha
// finito continua a girare da fantasma, e' voluto), quindi la fisica non si
// era mai fermata. Il riavvio rimetteva le auto in griglia e poi lasciava
// passare RESTART_GRACE_MS di pausa di cortesia: durante quella pausa
// updateBotInputs continuava a guidare i bot, che se ne andavano. L'umano no,
// perche' il suo client era al podio e non mandava input.
//
// Nello stesso giro e' emerso un secondo residuo della stessa natura:
// `raceGraceEndTick` e' un contatore di TICK e non veniva mai azzerato, mentre
// il riavvio riporta `raceTick` a zero — la sessione nuova si sarebbe chiusa
// da sola appena il contatore avesse riraggiunto il valore vecchio.
const test = require('node:test');
const assert = require('node:assert/strict');
const { lobbies, creaGettone } = require('../../store/lobbies.js');
const { activeGames } = require('../../store/activeGames.js');
const registraHandlerF1 = require('./f1GameSocket.js');

const LOBBY = 'TESTRIAVVIO';

// Registra ogni emit per destinatario: serve a guardare COSA riceve davvero
// un client, non solo cosa vale lo stato sul server.
function ioFinto() {
    const inviati = [];
    return {
        inviati,
        to: (dest) => ({ emit: (evento, dati) => inviati.push({ dest, evento, dati }) }),
    };
}

function collega(io) {
    const handlers = {};
    const socket = {
        id: 'sock-' + Math.random().toString(36).slice(2),
        data: {}, emessi: [], handlers,
        on(e, cb) { handlers[e] = cb; },
        emit(e, d) { this.emessi.push({ evento: e, dati: d }); },
        join() { },
    };
    registraHandlerF1(io, socket);
    return socket;
}

function pulisci() {
    const g = activeGames.get(LOBBY);
    if (g) {
        if (g.tick) clearInterval(g.tick);
        ['tyreSelectTimeout', 'qualiEndTimeout', 'endTimeout', 'chiusuraTimeout']
            .forEach(k => { if (g[k]) clearTimeout(g[k]); });
        Object.values(g.rejoinTimers || {}).forEach(clearTimeout);
    }
    activeGames.delete(LOBBY);
    lobbies.delete(LOBBY);
}

// Una gara con bot portata fino alla bandiera a scacchi.
function garaFinitaConBot(io) {
    lobbies.set(LOBBY, {
        host: 'red', players: ['red'], lockedPlayers: ['red'],
        gameSettings: { trackId: 'prova', botsEnabled: 'true', gridSize: '4' },
    });
    const a = collega(io);
    a.handlers.startGame({ lobbyId: LOBBY, gameId: 'f1', settings: { trackId: 'prova', botsEnabled: 'true', gridSize: '4' } });
    a.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'red', token: creaGettone(LOBBY, 'red') });

    const g = activeGames.get(LOBBY);
    g.phase = 'race';
    g.raceStarted = true;
    g.raceStartTime = Date.now();
    g.raceTick = 4000;
    g.grid = Object.keys(g.players);
    let t = 300000;
    for (const p of Object.values(g.players)) { p.finished = true; p.time = (t += 900); p.lap = g.track.totalLaps; }
    registraHandlerF1.endRace(io, LOBBY, g);
    return { a, g };
}

test('"Riavvia" non lascia scappare i bot: al countdown sono tutti ancora fermi al via', (t) => {
    t.after(pulisci);
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const io = ioFinto();
    const { a, g } = garaFinitaConBot(io);

    // Il podio resta a schermo qualche secondo, poi si preme "Riavvia".
    t.mock.timers.tick(5000);
    a.handlers.f1RestartRace(LOBBY);

    // La pausa di cortesia prima del countdown (RESTART_GRACE_MS).
    t.mock.timers.tick(1500);

    const via = g.track.qualiSpawn;
    for (const [colore, p] of Object.entries(g.players)) {
        const d = Math.hypot(p.x - via.x, p.z - via.z);
        assert.ok(d < 1,
            `${colore}${p.isBot ? ' (bot)' : ''} e' a ${d.toFixed(1)} unita' dal via quando parte il countdown`);
        assert.equal(p.speed, 0, `${colore} deve essere fermo, non a ${p.speed}`);
    }
});

test('una gara riavviata riparte dalla qualifica, non dalla griglia vecchia', (t) => {
    t.after(pulisci);
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const io = ioFinto();
    const { a, g } = garaFinitaConBot(io);
    const grigliaVecchia = [...g.grid];

    t.mock.timers.tick(5000);
    a.handlers.f1RestartRace(LOBBY);
    t.mock.timers.tick(1500);

    assert.equal(activeGames.get(LOBBY), g, 'Riavvia deve riusare la partita, non crearne una nuova');
    assert.equal(g.phase, 'qualifying', 'il riavvio deve riportare alla QUALIFICA');
    assert.equal(g.raceEnded, false);
    assert.equal(g.grid, null,
        `la griglia e' il risultato della qualifica: non puo' sopravvivere al riavvio (era ${grigliaVecchia.join(', ')})`);
    for (const p of Object.values(g.players)) {
        assert.equal(p.finished, false);
        assert.equal(p.lap, 0);
        assert.equal(p.time, null);
    }
});

test('il riavvio disarma la finestra di cortesia della gara precedente', (t) => {
    // raceGraceEndTick e' un numero di TICK, e il riavvio riporta raceTick a
    // zero: se restasse armato, la sessione nuova si chiuderebbe da sola
    // appena il contatore riraggiunge quel valore.
    t.after(pulisci);
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const io = ioFinto();
    const { a, g } = garaFinitaConBot(io);
    g.raceGraceEndTick = 4600;

    t.mock.timers.tick(5000);
    a.handlers.f1RestartRace(LOBBY);

    assert.equal(g.raceGraceEndTick, null, 'la finestra di cortesia di fine gara deve essere disarmata');
    assert.equal(g.raceTick, 0, 'il cronometro della sessione riparte da zero');
});

test('la qualifica riavviata si corre con auto integra e gomme fresche', (t) => {
    t.after(pulisci);
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const io = ioFinto();
    const { a, g } = garaFinitaConBot(io);

    // Come si arriva al traguardo dopo una gara vera.
    const red = g.players.red;
    red.tyreWear = 0.9;
    red.damage = 0.7;
    red.collisionPenaltyMs = 5000;
    red.hasPitted = true;
    red.falseStart = true;
    red.pitPenalty = true;

    t.mock.timers.tick(5000);
    a.handlers.f1RestartRace(LOBBY);
    t.mock.timers.tick(1500);

    assert.equal(red.tyreWear, 0, 'gomme fresche');
    assert.equal(red.damage, 0, 'auto integra');
    assert.equal(red.collisionPenaltyMs, 0);
    assert.equal(red.hasPitted, false);
    assert.equal(red.falseStart, false);
    assert.equal(red.pitPenalty, false);
});

test('dopo il riavvio la sequenza arriva fino in fondo: qualifica -> griglia -> gara', (t) => {
    // Il rischio vero di far ripartire una partita gia' usata non e' il primo
    // istante, e' restare incastrati piu' avanti per un residuo non ripulito.
    t.after(pulisci);
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const io = ioFinto();
    const { a, g } = garaFinitaConBot(io);

    t.mock.timers.tick(5000);
    a.handlers.f1RestartRace(LOBBY);
    t.mock.timers.tick(1500);   // la pausa di cortesia: qui parte la qualifica
    t.mock.timers.tick(3000);   // il 3-2-1
    assert.equal(g.phase, 'qualifying');
    assert.equal(g.raceStarted, true, 'il giro di qualifica deve essere partito');

    // Tutti chiudono il loro giro secco.
    let t2 = 60000;
    for (const p of Object.values(g.players)) { p.finished = true; p.time = (t2 += 700); }
    t.mock.timers.tick(2000);   // il gate in tickGame apre la finestra di grazia e chiude
    assert.equal(g.phase, 'grid_display', `la qualifica deve chiudersi (fase "${g.phase}")`);
    assert.ok(g.grid && g.grid.length, 'e produrre una griglia nuova');

    // La sequenza della griglia e poi il semaforo.
    t.mock.timers.tick(60000);
    assert.equal(g.phase, 'race', `si deve arrivare in gara (fase "${g.phase}")`);
    assert.equal(g.raceEnded, false, 'e la gara non deve essere gia\' finita');
});

test('durante la pausa del riavvio nessuno riceve le auto degli altri', (t) => {
    // Segnalato in playtest: "ho fatto riavvia e oltre a me in qualifica c'era
    // un'altra macchina, di un bot". La fase restava 'race' per tutta la pausa
    // di cortesia mentre le auto erano gia' tutte impilate sul via della
    // qualifica: il server le trasmetteva tutte, sovrapposte, e il client se le
    // teneva a schermo anche dopo, perche' da li' in poi non le riceveva piu'.
    t.after(pulisci);
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const io = ioFinto();
    const { a, g } = garaFinitaConBot(io);

    t.mock.timers.tick(5000);
    a.handlers.f1RestartRace(LOBBY);

    assert.equal(g.phase, 'qualifying',
        'la fase deve cambiare INSIEME allo schieramento, non fra RESTART_GRACE_MS');

    io.inviati.length = 0;
    t.mock.timers.tick(500);   // qualche tick di pausa, prima del countdown

    const stati = io.inviati.filter(m => m.evento === 'f1StateUpdate');
    assert.ok(stati.length > 0, 'lo stato deve continuare a viaggiare durante la pausa');
    for (const m of stati) {
        const colori = Object.keys(m.dati).filter(k => !k.startsWith('__'));
        assert.deepEqual(colori, ['red'],
            `un client riceve ${colori.join(', ')}: in qualifica si vede solo la propria auto`);
    }
});
