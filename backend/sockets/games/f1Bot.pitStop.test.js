// backend/sockets/games/f1Bot.pitStop.test.js
//
// Un bot che ha deciso di fermarsi ai box ci deve ENTRARE davvero.
//
// Segnalato in playtest: "loro ci provano ma non riescono". Confermato
// headless — su cinque bot, zero soste in tutta la gara.
//
// La causa è un formato: il riquadro d'ingresso è diventato ORIENTABILE il
// 2026-08-08 ({x, z, halfWidth, halfLength, angle}), ma la guida dei bot
// continuava a leggerlo col vecchio formato ad assi allineati
// (xMin/xMax/zMin/zMax). Quei campi non esistono più: `p.x >= undefined` è
// sempre falso, quindi il bot non si accorgeva MAI di essere dentro il
// trigger e continuava a inseguire il punto di raccordo invece di
// attraversare. Il riquadro ce l'ha un solo proprietario — TrackGeometry —
// e adesso lo leggono da lì sia il server (inPitEntryZone) sia i bot.
//
// Conseguenza a valle, ed è il motivo per cui la segnalazione è arrivata
// dalla classifica e non dai box: senza sosta scatta la penalità di 30
// secondi per tutti, e in una gara chiusa dalla finestra di cortesia i bot
// ancora in pista non passano da lì — prendevano un tempo proiettato SENZA
// penalità e finivano davanti a un umano che la penalità l'aveva presa.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { lobbies } = require('../../store/lobbies.js');
const { activeGames } = require('../../store/activeGames.js');
const f1 = require('./f1GameSocket.js');

const TRACCIATI = fs
    .readdirSync(path.join(__dirname, '..', '..', '..', 'frontend', 'tracks'))
    .filter(f => f.endsWith('.json') && !/^(__|test-)/.test(f))
    .map(f => f.replace(/\.json$/, ''));

const TICK_MS = 50;
const ioFinto = { to: () => ({ emit: () => { } }) };

// Una gara di soli bot, pronta a girare. L'umano si CANCELLA invece di
// essere convertito in bot: l'IA guida un'auto priva dei campi che si
// aspetta e produce NaN (già costato un probe).
function garaDiSoliBot(lobbyId, trackId, quanti) {
    lobbies.set(lobbyId, {
        host: 'red', players: ['red'], lockedPlayers: ['red'],
        gameSettings: { trackId },
    });
    const handlers = {};
    f1(ioFinto, { id: 's', data: {}, on: (e, cb) => handlers[e] = cb, emit() { }, join() { } });
    handlers.joinF1Game({ lobbyId, playerColor: 'red' });
    const g = activeGames.get(lobbyId);
    clearInterval(g.tick);

    delete g.players.red;
    while (Object.keys(g.players).length > quanti) {
        delete g.players[Object.keys(g.players).pop()];
    }
    g.grid = Object.keys(g.players);
    f1.physics.assignGridSpawns(g);
    g.phase = 'race';
    g.raceStarted = true;
    g.raceStartTime = Date.now();
    g.raceTick = 0;
    // Nessuna forzatura sulla soglia di usura: la sosta si lascia decidere
    // all'IA come in gara vera. Anche il bot più conservativo è comunque
    // obbligato a fermarsi all'ultimo giro (BOT_FORCE_PIT_LAPS_REMAINING),
    // quindi una gara intera contiene sempre almeno un tentativo per bot.
    for (const p of Object.values(g.players)) p.botRaceReactionUntil = 0;
    return g;
}

function pulisci(lobbyId) {
    const g = activeGames.get(lobbyId);
    if (g) {
        if (g.tick) clearInterval(g.tick);
        for (const k of ['tyreSelectTimeout', 'qualiEndTimeout', 'endTimeout']) {
            if (g[k]) clearTimeout(g[k]);
        }
    }
    activeGames.delete(lobbyId);
    lobbies.delete(lobbyId);
}

for (const id of TRACCIATI) {
    test(`${id}: i bot entrano davvero in corsia box`, (t) => {
        // Il tempo è virtuale: la reazione al pit stop passa da setTimeout, e
        // un ciclo di tick sincrono non la farebbe mai scattare (il primo
        // probe diceva "nessuna sosta" anche per questo motivo, oltre che per
        // il bug vero).
        t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
        const LOBBY = `PITSTOP_${id}`;
        t.after(() => pulisci(LOBBY));

        const g = garaDiSoliBot(LOBBY, id, 3);
        const MAX_TICK = 900000 / TICK_MS;   // quindici minuti virtuali: tetto di sicurezza
        const entrati = new Set();

        for (let i = 0; i < MAX_TICK; i++) {
            f1.tickGame(ioFinto, LOBBY, g);
            t.mock.timers.tick(TICK_MS);
            for (const p of Object.values(g.players)) {
                if (p.pitting || p.pitAutoState) entrati.add(p.color);
            }
            if (Object.values(g.players).every(p => p.finished || p.hasPitted)) break;
        }

        const soste = Object.values(g.players).filter(p => p.hasPitted).length;
        const totale = Object.keys(g.players).length;
        assert.equal(soste, totale,
            `${soste}/${totale} bot si sono fermati; ${entrati.size} avevano almeno imboccato la corsia`);
    });
}
