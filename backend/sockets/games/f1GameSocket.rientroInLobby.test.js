// backend/sockets/games/f1GameSocket.rientroInLobby.test.js
//
// Chiusura della partita al rientro in lobby.
//
// Il difetto che questi test proteggono (segnalato in playtest: "se ritorno
// in lobby e poi provo ad avviare di nuovo una gara si bugga"). In
// multiplayer il podio finale riporta in lobby da solo, con un
// `window.location.href` a fine conto alla rovescia — e basta: nessun evento
// diceva al server che la sessione era finita. `f1ReturnToLobby`, che è
// l'unico punto in cui la partita viene davvero smontata, lo emette solo il
// pulsante della modalità singolo.
//
// Riprodotto headless: la partita conclusa restava in `activeGames`, quindi
// il `joinF1Game` della gara successiva trovava `activeGames.has(lobbyId)`
// vero e NON ne creava una nuova. Tutti rientravano nella gara finita —
// fase `race_end`, piloti ancora `finished`, tempi e griglia della gara
// precedente, e persino la pista vecchia (cambiarla in lobby non aveva
// effetto). In più i timer di riconnessione di quella partita restavano
// armati: 60 secondi dopo il rientro `hardRemoveF1Player` toglieva i
// giocatori da `lobby.players` mentre erano seduti in lobby, svuotando la
// lista e riassegnando l'host.
const test = require('node:test');
const assert = require('node:assert/strict');
const { lobbies, creaGettone } = require('../../store/lobbies.js');
const { activeGames } = require('../../store/activeGames.js');
const registraHandlerF1 = require('./f1GameSocket.js');

const LOBBY = 'TESTRIENTRO';

function ioFinto() {
    return { to: () => ({ emit: () => { } }) };
}

function collega(io) {
    const handlers = {};
    const socket = {
        id: 'sock-' + Math.random().toString(36).slice(2),
        data: {},
        emessi: [],
        handlers,
        on(evento, cb) { handlers[evento] = cb; },
        emit(evento, dati) { this.emessi.push({ evento, dati }); },
        join() { },
    };
    registraHandlerF1(io, socket);
    return socket;
}

function preparaLobby(colori, extra = {}) {
    lobbies.set(LOBBY, {
        host: colori[0],
        players: [...colori],
        lockedPlayers: [...colori],
        gameSettings: { trackId: 'prova', botsEnabled: 'false', ...extra },
    });
}

function pulisci() {
    const g = activeGames.get(LOBBY);
    if (g) {
        if (g.tick) clearInterval(g.tick);
        if (g.tyreSelectTimeout) clearTimeout(g.tyreSelectTimeout);
        if (g.qualiEndTimeout) clearTimeout(g.qualiEndTimeout);
        if (g.endTimeout) clearTimeout(g.endTimeout);
        if (g.chiusuraTimeout) clearTimeout(g.chiusuraTimeout);
        Object.values(g.rejoinTimers || {}).forEach(clearTimeout);
    }
    activeGames.delete(LOBBY);
    lobbies.delete(LOBBY);
}

// Porta una partita appena creata fino alla bandiera a scacchi, senza
// simulare la gara: i test qui riguardano ciò che succede DOPO.
function faiFinireLaGara(io, colori) {
    const g = activeGames.get(LOBBY);
    g.phase = 'race';
    g.grid = [...colori];
    for (const p of Object.values(g.players)) {
        p.finished = true;
        p.time = 60000;
        p.lap = g.track.totalLaps;
    }
    registraHandlerF1.endRace(io, LOBBY, g);
    return g;
}

test('finita una gara multiplayer il server chiude la partita da solo', (t) => {
    t.after(pulisci);
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    preparaLobby(['red', 'blue']);
    const io = ioFinto();

    const a = collega(io); a.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'red', token: creaGettone(LOBBY, 'red') });
    const b = collega(io); b.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'blue', token: creaGettone(LOBBY, 'blue') });
    faiFinireLaGara(io, ['red', 'blue']);

    // Il client naviga verso la lobby a fine conto alla rovescia: il socket
    // muore senza emettere nulla.
    a.handlers.disconnect();
    b.handlers.disconnect();

    t.mock.timers.tick(60000);
    assert.equal(activeGames.has(LOBBY), false,
        'la partita conclusa deve sparire da activeGames senza aspettare che il client lo chieda');
});

test('riavviare una gara dopo il rientro in lobby parte da zero, sulla pista scelta', (t) => {
    t.after(pulisci);
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    preparaLobby(['red', 'blue']);
    const io = ioFinto();

    const a = collega(io); a.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'red', token: creaGettone(LOBBY, 'red') });
    const b = collega(io); b.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'blue', token: creaGettone(LOBBY, 'blue') });
    faiFinireLaGara(io, ['red', 'blue']);
    a.handlers.disconnect();
    b.handlers.disconnect();
    t.mock.timers.tick(60000);

    // In lobby l'host cambia pista e riavvia.
    lobbies.get(LOBBY).gameSettings.trackId = 'monte-rosso';
    const a2 = collega(io); a2.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'red', token: creaGettone(LOBBY, 'red') });
    const b2 = collega(io); b2.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'blue', token: creaGettone(LOBBY, 'blue') });

    const g = activeGames.get(LOBBY);
    assert.equal(g.phase, 'tyre_select', 'la nuova gara deve ripartire dalla scelta mescola');
    assert.equal(g.raceEnded, false, 'la nuova gara non puo nascere gia finita');
    assert.equal(g.track.id, 'monte-rosso', 'deve caricare la pista scelta in lobby, non quella della gara precedente');
    assert.equal(g.grid, null, 'la griglia della gara precedente non deve sopravvivere');
    assert.equal(g.players.red.finished, false, 'il pilota non puo ripartire gia arrivato');
    assert.equal(g.players.red.time, null, 'il tempo della gara precedente non deve sopravvivere');
    assert.equal(g.players.red.lap, 0, 'il conteggio giri deve ripartire da zero');
});

test('la partita chiusa non svuota la lobby un minuto dopo', (t) => {
    t.after(pulisci);
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    preparaLobby(['red', 'blue']);
    const io = ioFinto();

    const a = collega(io); a.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'red', token: creaGettone(LOBBY, 'red') });
    const b = collega(io); b.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'blue', token: creaGettone(LOBBY, 'blue') });
    faiFinireLaGara(io, ['red', 'blue']);
    a.handlers.disconnect();
    b.handlers.disconnect();

    // Oltre la grazia di riconnessione (60s): e li che scattava la rimozione.
    t.mock.timers.tick(120000);

    const lobby = lobbies.get(LOBBY);
    assert.deepEqual(lobby.players, ['red', 'blue'],
        'chi e rientrato in lobby non deve essere rimosso dai timer della partita finita');
    assert.equal(lobby.host, 'red', 'e l host non deve cambiare da solo');
});

test('chi abbandona DURANTE la gara viene comunque tolto dalla lobby', (t) => {
    t.after(pulisci);
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    preparaLobby(['red', 'blue', 'green']);
    const io = ioFinto();

    const a = collega(io); a.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'red', token: creaGettone(LOBBY, 'red') });
    const b = collega(io); b.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'blue', token: creaGettone(LOBBY, 'blue') });
    const c = collega(io); c.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'green', token: creaGettone(LOBBY, 'green') });

    // "green" chiude il browser a meta gara: non tornera in lobby.
    c.handlers.disconnect();
    faiFinireLaGara(io, ['red', 'blue', 'green']);
    a.handlers.disconnect();
    b.handlers.disconnect();
    t.mock.timers.tick(120000);

    const lobby = lobbies.get(LOBBY);
    assert.deepEqual(lobby.players, ['red', 'blue'],
        'chi se ne e andato prima della fine non deve restare come fantasma nella lista');
});

test('da solo la partita sopravvive al podio quanto basta per "Riprova", non di piu', (t) => {
    t.after(pulisci);
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    preparaLobby(['red']);
    const io = ioFinto();

    const a = collega(io); a.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'red', token: creaGettone(LOBBY, 'red') });
    faiFinireLaGara(io, ['red']);

    // Durante il podio la partita c'e' ancora: e' quella che "Riprova" riusa.
    t.mock.timers.tick(15000);
    assert.equal(activeGames.has(LOBBY), true,
        'finche il podio e a schermo "Riprova" deve poter riusare la partita');

    // Ma se nessuno preme niente, muore. Prima no, e una partita in singolo
    // abbandonata chiudendo la scheda restava in activeGames per sempre.
    t.mock.timers.tick(15000);
    assert.equal(activeGames.has(LOBBY), false,
        'passato il podio senza che nessuno abbia premuto, la partita va smontata');
});

// ────────────────────────────────────────────────────────────────────────
// AVVIARE UNA GARA DALLA LOBBY COMINCIA SEMPRE UNA SESSIONE NUOVA
//
// Il difetto che questi test proteggono (playtest 2026-08-18, dopo il primo
// giro di correzioni). La chiusura automatica di fine gara copre solo le
// sessioni che FINISCONO. Chi abbandona a meta' - F5, tasto indietro, torna
// in lobby a mano - lascia la partita viva per tutta la grazia di
// riconnessione (60 s), ed e' giusto che sia cosi': serve a rientrare senza
// perdere posizione e giro.
//
// Ma il `joinF1Game` della gara SUCCESSIVA non sa distinguere i due casi, e
// quella partita se la ritrovava davanti: rientrava dentro la sessione
// vecchia invece di crearne una nuova. Riprodotto headless, con la sequenza
// segnalata (gara su monte-rosso abbandonata, poi gara su prova):
//
//   il client carica   prova       (dalle impostazioni nell'indirizzo)
//   il server simula   monte-rosso
//
// Da cui i tre sintomi visti in playtest: l'auto "nel verde, immersa nello
// sfondo" (coordinate di un'altra pista), il pannello "qualifica completata,
// in attesa degli altri piloti" che non spariva piu' (qualiGraceEndTick della
// sessione precedente) e l'impossibilita' di muoversi (lato server il
// giocatore era gia' arrivato).
//
// La soluzione non guarda come e' finita la sessione precedente - non puo',
// i modi di abbandonare sono infiniti - ma da che sessione arriva chi entra:
// `startGame` timbra la lobby, e una partita con un altro timbro viene
// chiusa e rifatta.
// ────────────────────────────────────────────────────────────────────────

// startGame SOSTITUISCE lobby.gameSettings: quello che non si passa qui viene
// perso, modalita' compresa. Va detto perche' e' gia' costato un test rosso
// che sembrava un difetto di produzione e non lo era.
function avvia(socket, trackId, extra) {
    socket.handlers.startGame({
        lobbyId: LOBBY, gameId: 'f1',
        settings: Object.assign({ trackId, botsEnabled: 'false', gridSize: '4' }, extra || {}),
    });
}

test('una gara avviata dalla lobby non rientra in quella abbandonata a meta', (t) => {
    t.after(pulisci);
    preparaLobby(['red']);
    const io = ioFinto();

    const a = collega(io);
    avvia(a, 'monte-rosso');
    a.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'red', token: creaGettone(LOBBY, 'red') });

    // Sessione in corso, poi abbandonata a meta'.
    const vecchia = activeGames.get(LOBBY);
    vecchia.phase = 'qualifying';
    vecchia.raceTick = 900;
    vecchia.qualiGraceEndTick = 1060;
    vecchia.players.red.finished = true;
    a.handlers.disconnect();
    assert.equal(activeGames.has(LOBBY), true,
        'la grazia di riconnessione deve tenere viva la partita: serve a rientrare dopo un F5');

    // Dalla lobby si avvia una gara nuova, su un'altra pista.
    const b = collega(io);
    avvia(b, 'prova');
    b.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'red', token: creaGettone(LOBBY, 'red') });

    const g = activeGames.get(LOBBY);
    assert.notEqual(g, vecchia, 'deve essere una partita nuova, non quella di prima');
    assert.equal(g.track.id, 'prova',
        'il server deve simulare la pista che il client ha caricato, altrimenti l\'auto finisce nel verde');
    assert.equal(g.phase, 'tyre_select', 'si riparte dalla scelta mescola');
    assert.equal(g.raceTick, 0);
    assert.equal(g.qualiGraceEndTick, undefined,
        'con la grazia della qualifica precedente il pannello "in attesa degli altri" non sparisce piu');
    assert.equal(g.players.red.finished, false, 'lato server il pilota non puo ripartire gia arrivato');
});

test('dentro la stessa sessione un refresh resta un rientro, non una gara nuova', (t) => {
    t.after(pulisci);
    preparaLobby(['red']);
    const io = ioFinto();

    const a = collega(io);
    avvia(a, 'prova');
    a.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'red', token: creaGettone(LOBBY, 'red') });
    const g0 = activeGames.get(LOBBY);
    g0.phase = 'race';
    g0.players.red.lap = 2;

    // F5 in mezzo alla gara: nessun startGame, quindi la sessione e' la stessa.
    a.handlers.disconnect();
    const b = collega(io);
    b.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'red', token: creaGettone(LOBBY, 'red') });

    assert.equal(activeGames.get(LOBBY), g0, 'deve rientrare nella partita in corso');
    assert.equal(activeGames.get(LOBBY).players.red.lap, 2, 'senza perdere il giro');
});

test('un timer della sessione precedente non spinge in gara quella nuova', (t) => {
    // Tutti i timer di fase controllavano solo che una partita ESISTESSE, non
    // che fosse la stessa. Ora che avviare una gara dalla lobby chiude e rifa'
    // la partita, quel controllo non basta piu': il timer della sessione morta
    // trovava la partita NUOVA e la spingeva in fase 'race' mentre i piloti
    // stavano ancora scegliendo le gomme.
    t.after(pulisci);
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    preparaLobby(['red']);
    const io = ioFinto();

    const a = collega(io);
    avvia(a, 'monte-rosso');
    a.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'red', token: creaGettone(LOBBY, 'red') });
    const vecchia = activeGames.get(LOBBY);
    vecchia.phase = 'race_end';
    vecchia.grid = ['red'];
    // "Riprova": programma il semaforo fra RESTART_GRACE_MS.
    a.handlers.f1RestartRace(LOBBY);

    // Nel frattempo si riparte dalla lobby, su un'altra pista.
    const b = collega(io);
    avvia(b, 'prova');
    b.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'red', token: creaGettone(LOBBY, 'red') });
    const nuova = activeGames.get(LOBBY);
    assert.notEqual(nuova, vecchia, 'la sessione dev\'essere stata sostituita');

    t.mock.timers.tick(30000);
    assert.equal(nuova.phase, 'tyre_select',
        `la gara nuova e' finita in fase "${nuova.phase}" per colpa di un timer della sessione precedente`);
});

test('il socket della sessione precedente non tocca il pilota di quella nuova', (t) => {
    // Segnalato in playtest: gara su monte-rosso, rientro in lobby SUBITO
    // (tasto invio, senza aspettare la fine della finestra di cortesia), gara
    // su new-monza. Finito il giro di qualifica il pannello "in attesa degli
    // altri piloti" non spariva piu', e circa un minuto dopo il terminale
    // stampava "grazia scaduta" e l'auto si bloccava del tutto.
    //
    // Tornare SUBITO e' esattamente cio' che innesca la corsa: la
    // disconnessione del vecchio socket arriva al server DOPO che la partita
    // nuova e' gia' nata. Il gestore leggeva "la partita di questa lobby" e
    // trovava quella nuova: marcava disconnesso il pilota VIVO (che cosi' non
    // contava piu' per la chiusura della qualifica) e gli armava addosso il
    // timer di rimozione definitiva. Sessanta secondi dopo lo cancellava dalla
    // partita in corso - da cui il blocco.
    t.after(pulisci);
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    preparaLobby(['red']);
    const io = ioFinto();

    const vecchio = collega(io);
    avvia(vecchio, 'monte-rosso');
    vecchio.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'red', token: creaGettone(LOBBY, 'red') });

    // Rientro in lobby e avvio della gara nuova, PRIMA che il socket vecchio
    // sia dichiarato morto.
    const nuovo = collega(io);
    avvia(nuovo, 'new-monza');
    nuovo.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'red', token: creaGettone(LOBBY, 'red') });
    const g = activeGames.get(LOBBY);
    assert.equal(g.track.id, 'new-monza');

    // Solo ORA il server si accorge che il vecchio socket e' caduto.
    vecchio.handlers.disconnect();

    assert.equal(g.players.red.disconnected, false,
        'il pilota vivo e stato marcato disconnesso: non conta piu per la chiusura della qualifica');
    assert.equal(Object.keys(g.rejoinTimers || {}).length, 0,
        'e gli e stato armato addosso il timer di rimozione della sessione precedente');

    t.mock.timers.tick(120000);
    assert.ok(g.players.red, 'il pilota e stato cancellato dalla partita in corso: da li in poi non si muove piu');
    assert.deepEqual(lobbies.get(LOBBY).players, ['red'], 'e tolto anche dalla lobby');
});

// ────────────────────────────────────────────────────────────────────────
// IL CICLO COMPLETO CON LA PREMIAZIONE IN MEZZO
//
// La premiazione allunga la finestra fra la bandiera a scacchi e il rientro
// in lobby da 8 a 19.2 secondi, e ci mette dentro due modi di uscire: il
// pulsante e la scadenza del tempo. E' esattamente il tratto in cui vivevano
// i difetti peggiori trovati finora (partita riusata, socket di una sessione
// che tocca quella dopo), quindi il giro completo si verifica invece di
// darlo per buono.
// ────────────────────────────────────────────────────────────────────────

function faiFinireLaGaraVera(io, socket) {
    const g = activeGames.get(LOBBY);
    g.phase = 'race';
    let t = 300000;
    for (const p of Object.values(g.players)) {
        p.finished = true; p.time = (t += 900); p.lap = g.track.totalLaps;
    }
    registraHandlerF1.endRace(io, LOBBY, g);
    return g;
}

test('premiazione, scadenza del tempo, e la gara dopo parte pulita', (t) => {
    t.after(pulisci);
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    preparaLobby(['red']);
    const io = ioFinto();

    const a = collega(io);
    avvia(a, 'monte-rosso');
    a.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'red', token: creaGettone(LOBBY, 'red') });
    const vecchia = faiFinireLaGaraVera(io, a);

    // Il tempo scade: il client naviga da solo e il suo socket muore.
    t.mock.timers.tick(19200);
    a.handlers.disconnect();
    t.mock.timers.tick(5000);
    assert.equal(activeGames.has(LOBBY), false,
        'a premiazione finita la partita deve essere smontata dal server');

    // Nuova gara, altra pista.
    const b = collega(io);
    avvia(b, 'prova');
    b.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'red', token: creaGettone(LOBBY, 'red') });
    const g = activeGames.get(LOBBY);
    assert.notEqual(g, vecchia);
    assert.equal(g.track.id, 'prova');
    assert.equal(g.phase, 'tyre_select');
    assert.equal(g.players.red.finished, false);
});

test('il pulsante di chi ospita chiude la partita e riporta tutti in lobby', (t) => {
    t.after(pulisci);
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    preparaLobby(['red']);
    const io = ioFinto();

    const a = collega(io);
    avvia(a, 'monte-rosso');
    a.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'red', token: creaGettone(LOBBY, 'red') });
    faiFinireLaGaraVera(io, a);

    // Premuto a meta' premiazione, senza aspettare la scadenza.
    t.mock.timers.tick(6000);
    a.handlers.f1ReturnToLobby(LOBBY);
    assert.equal(activeGames.has(LOBBY), false,
        'il pulsante di chi ospita deve smontare la partita subito');

    // E il timer di smontaggio gia' programmato non deve toccare nulla dopo.
    t.mock.timers.tick(30000);
    assert.equal(activeGames.has(LOBBY), false);
    assert.deepEqual(lobbies.get(LOBBY).players, ['red'],
        'chi e rientrato in lobby non deve sparire dalla lista');
});

test('"Riprova" durante la premiazione rilancia la stessa partita', (t) => {
    t.after(pulisci);
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    preparaLobby(['red']);
    const io = ioFinto();

    const a = collega(io);
    avvia(a, 'monte-rosso');
    a.handlers.joinF1Game({ lobbyId: LOBBY, playerColor: 'red', token: creaGettone(LOBBY, 'red') });
    const g = faiFinireLaGaraVera(io, a);
    g.grid = ['red'];

    t.mock.timers.tick(5000);
    a.handlers.f1RestartRace(LOBBY);
    t.mock.timers.tick(20000);

    assert.equal(activeGames.get(LOBBY), g,
        'Riprova deve riusare la partita, non crearne una nuova');
    assert.equal(g.phase, 'race', 'e riportarla in gara');
    assert.equal(g.raceEnded, false);
});
