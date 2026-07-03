const { activeGames } = require('../../store/activeGames');
const { lobbies } = require('../../store/lobbies');

const PHYSICS_TICK_MS = 50;
const MAX_SPEED    = 4.0;
const ACCEL        = 0.12;
const FRICTION     = 0.050;
const TURN_SPEED   = 0.048;
const GRIP         = 0.78;
const ROAD_HALF    = 11;

// ====================================================
// PUNTI SPAWN (rettilineo principale x≈-30, z crescente)
// ====================================================
const SPAWN_POINTS = [
    { x: -26, z:  8, angle: 0 },
    { x: -34, z:  8, angle: 0 },
    { x: -26, z: 18, angle: 0 },
    { x: -34, z: 18, angle: 0 },
    { x: -26, z: 28, angle: 0 },
    { x: -34, z: 28, angle: 0 },
    { x: -26, z: 38, angle: 0 },
    { x: -34, z: 38, angle: 0 },
];

// ====================================================
// PUNTI DELLA PISTA (per rilevamento uscita)
// Interpolazione lineare tra i waypoint del frontend
// ====================================================
function leftCX(z) {
    if (z <= 60)  return -30;
    if (z <= 82)  return -30 + (z - 60) / 22 * 14;   // -30 → -16
    if (z <= 100) return -16 + (z - 82) / 18 * 8;    // -16 → -8
    if (z <= 118) return  -8 - (z - 100) / 18 * 8;   // -8 → -16
    if (z <= 145) return -16 - (z - 118) / 27 * 14;  // -16 → -30
    return -30;
}
function rightCX(z) {
    if (z <= 60)  return 130;
    if (z <= 82)  return 130 + (z - 60) / 22 * 16;   // 130 → 146
    if (z <= 100) return 146 - (z - 82) / 18 * 8;    // 146 → 138
    if (z <= 118) return 138 + (z - 100) / 18 * 8;   // 138 → 146
    if (z <= 145) return 146 - (z - 118) / 27 * 16;  // 146 → 130
    return 130;
}

const TRACK_POINTS = (() => {
    const pts = [];
    for (let z = -5; z <= 205; z += 3) pts.push({ x: leftCX(z),  z });
    for (let a = 180; a >= 0; a -= 3) {
        const r = a * Math.PI / 180;
        pts.push({ x: 50 + 80 * Math.cos(r), z: 200 + 80 * Math.sin(r) });
    }
    for (let z = 205; z >= -5; z -= 3) pts.push({ x: rightCX(z), z });
    for (let a = 0; a >= -180; a -= 3) {
        const r = a * Math.PI / 180;
        pts.push({ x: 50 + 80 * Math.cos(r), z: 80 * Math.sin(r) });
    }
    return pts;
})();

function nearestTrackDist(x, z) {
    let min = Infinity;
    for (const pt of TRACK_POINTS) {
        const d = (x - pt.x) ** 2 + (z - pt.z) ** 2;
        if (d < min) min = d;
    }
    return Math.sqrt(min);
}

// ====================================================
// SOCKET HANDLER
// ====================================================
module.exports = function (io, socket) {

    socket.on('startGame', (data) => {
        const { lobbyId, gameId, settings } = data;
        if (gameId !== 'f1') return;
        const lobby = lobbies.get(lobbyId);
        if (lobby) {
            lobby.gameSettings = settings;
            lobby.lockedPlayers = [...lobby.players];
        }
        io.to(lobbyId).emit('gameSelected', { gameId, settings });
    });

    socket.on('joinF1Game', ({ lobbyId, playerColor }) => {
        socket.join(lobbyId);
        socket.lobbyId = lobbyId;
        socket.color   = playerColor;

        if (!activeGames.has(lobbyId)) {
            const lobby = lobbies.get(lobbyId);
            activeGames.set(lobbyId, {
                gameId:        'f1',   // marca il tipo: gli handler condivisi (disconnect) NON devono toccare partite di altri giochi
                players:       {},
                tick:          null,
                raceStarted:   false,
                raceEnded:     false,
                raceStartTime: null,
                endTimeout:    null,
                hostColor:     lobby ? lobby.host : playerColor,
                settings:      lobby ? (lobby.gameSettings || {}) : {}
            });
        }

        const game     = activeGames.get(lobbyId);
        const spawnIdx = Object.keys(game.players).length;
        const spawn    = SPAWN_POINTS[spawnIdx % SPAWN_POINTS.length];
        const totalLaps = parseInt((game.settings || {}).laps) || 3;

        game.players[playerColor] = {
            color:           playerColor,
            x:               spawn.x,
            z:               spawn.z,
            angle:           spawn.angle,
            speed:           0,
            vx:              0,
            vz:              0,
            inputs:          { w: false, a: false, s: false, d: false },
            finished:        false,
            time:            null,
            lap:             0,
            checkpointA:     false,
            inFinishZone:    false,
        };

        socket.emit('f1Setup', {
            playerColor,
            hostColor:  game.hostColor,
            trackName:  'Monte Rosso',
            totalLaps,
            players:    buildPublicState(game.players)
        });

        // Countdown e tick solo al primo giocatore
        if (!game.tick) {
            game.tick = setInterval(() => tickGame(io, lobbyId, game), PHYSICS_TICK_MS);
            io.to(lobbyId).emit('f1Countdown', { trackName: 'Monte Rosso' });
            setTimeout(() => {
                const g = activeGames.get(lobbyId);
                if (!g) return;
                g.raceStarted   = true;
                g.raceStartTime = Date.now();
                console.log(`🚦 [F1] Gara avviata (lobby ${lobbyId})`);
                io.to(lobbyId).emit('f1RaceStarted', { syncTime: 0 });
            }, 3000);
        }
    });

    socket.on('f1Input', ({ lobbyId, playerColor, inputs }) => {
        const game = activeGames.get(lobbyId);
        if (!game || !game.players[playerColor]) return;
        game.players[playerColor].inputs = inputs;
    });

    socket.on('f1RestartRace', (lobbyId) => {
        const game = activeGames.get(lobbyId);
        if (!game) return;
        if (game.endTimeout) { clearTimeout(game.endTimeout); game.endTimeout = null; }
        game.raceEnded     = false;
        game.raceStarted   = false;
        game.raceStartTime = null;
        resetPlayers(game);
        io.to(lobbyId).emit('f1Countdown', { trackName: 'Monte Rosso' });
        setTimeout(() => {
            const g = activeGames.get(lobbyId);
            if (!g) return;
            g.raceStarted  = true;
            g.raceStartTime = Date.now();
            io.to(lobbyId).emit('f1RaceStarted', { syncTime: 0 });
        }, 3000);
    });

    socket.on('f1ReturnToLobby', (lobbyId) => {
        const game = activeGames.get(lobbyId);
        if (game && game.gameId !== 'f1') return;   // la partita attiva è di un altro gioco
        if (game) {
            clearInterval(game.tick);
            if (game.endTimeout) clearTimeout(game.endTimeout);
            activeGames.delete(lobbyId);
        }
        io.to(lobbyId).emit('f1RedirectToLobby');
    });

    // NB: questo handler scatta per OGNI socket che muore (anche i vecchi socket
    // della pagina lobby, che il browser tiene congelati per minuti dopo la
    // navigazione e hanno socket.lobbyId/color settati da joinLobby). Il guard
    // sul gameId è INDISPENSABILE: senza, cancellava i giocatori delle partite
    // di ALTRI giochi (bug storico: "danno morto" nell'FPS).
    socket.on('disconnect', () => {
        const { lobbyId, color } = socket;
        if (!lobbyId || !color) return;
        const game = activeGames.get(lobbyId);
        if (!game || game.gameId !== 'f1') return;
        delete game.players[color];
        io.to(lobbyId).emit('f1PlayerLeft', color);
        if (Object.keys(game.players).length === 0) {
            clearInterval(game.tick);
            if (game.endTimeout) clearTimeout(game.endTimeout);
            activeGames.delete(lobbyId);
        }
    });
};

// ====================================================
// TICK FISICO
// ====================================================
function tickGame(io, lobbyId, game) {
    if (!game.raceStarted) {
        io.to(lobbyId).emit('f1StateUpdate', buildPublicState(game.players));
        return;
    }
    const totalLaps = parseInt((game.settings || {}).laps) || 3;
    const players   = Object.values(game.players);

    for (const p of players) {
        if (p.finished) continue;
        const prevZ = p.z;
        updatePhysics(p);
        checkLap(p, prevZ, totalLaps, io, lobbyId, game);
    }

    // Fine gara: tutti finiti
    if (!game.raceEnded && players.length > 0 && players.every(p => p.finished)) {
        endRace(io, lobbyId, game);
        return;
    }

    io.to(lobbyId).emit('f1StateUpdate', buildPublicState(game.players));
}

// ====================================================
// LAP CHECK — zona-based (più robusto del crossing)
// Checkpoint A: z ∈ [150,210] sul rettilineo sx (x < 50)
// Traguardo:    z ∈ [0, 10]  sul rettilineo sx (x < 50), dopo aver passato A
// ====================================================
function checkLap(p, prevZ, totalLaps, io, lobbyId, game) {
    const onLeftSide = p.x < 50;   // esclude il rettilineo dx (x≈130)

    // Checkpoint A: il driver ha superato metà giro
    if (onLeftSide && p.z >= 150 && p.z <= 210 && !p.checkpointA) {
        p.checkpointA = true;
    }

    // Zona traguardo: z ∈ [0,10] sul rettilineo sx, dopo il checkpoint A
    const inFinishZone = onLeftSide && p.z >= 0 && p.z <= 10;
    if (p.checkpointA && inFinishZone && !p.inFinishZone) {
        // Il giocatore ha appena ENTRATO nella zona traguardo → giro completato
        p.lap++;
        p.checkpointA  = false;
        console.log(`🏁 [F1] ${p.color} giro ${p.lap}/${totalLaps} (lobby ${lobbyId})`);

        if (p.lap >= totalLaps) {
            p.finished = true;
            p.time     = Date.now() - game.raceStartTime;
            if (!game.endTimeout) {
                game.endTimeout = setTimeout(() => {
                    if (!game.raceEnded) endRace(io, lobbyId, game);
                }, 60000);
            }
        }

        io.to(lobbyId).emit('f1LapUpdate', { color: p.color, lap: p.lap, totalLaps });
    }
    p.inFinishZone = inFinishZone;
}

function endRace(io, lobbyId, game) {
    game.raceEnded = true;
    if (game.endTimeout) { clearTimeout(game.endTimeout); game.endTimeout = null; }
    const podium = Object.values(game.players)
        .filter(p => p.time !== null)
        .sort((a, b) => a.time - b.time)
        .map(p => ({ color: p.color, totalTime: p.time }));
    io.to(lobbyId).emit('f1RaceEnded', {
        podium,
        isFinal:      true,
        isSingleMode: (game.settings || {}).mode === 'single',
        trackName:    'Monte Rosso'
    });
}

// ====================================================
// FISICA
// ====================================================
function updatePhysics(p) {
    const { inputs } = p;

    if (inputs.w)      p.speed = Math.min(p.speed + ACCEL, MAX_SPEED);
    else if (inputs.s) {
        p.speed = Math.max(p.speed - ACCEL * 2, -MAX_SPEED / 2);
        p.vx *= 0.84;
        p.vz *= 0.84;
    } else {
        if (p.speed > 0) p.speed = Math.max(p.speed - FRICTION, 0);
        if (p.speed < 0) p.speed = Math.min(p.speed + FRICTION, 0);
    }

    if (Math.abs(p.speed) > 0.01 || (p.vx * p.vx + p.vz * p.vz) > 0.0001) {
        const dir = p.speed >= 0 ? 1 : -1;
        if (inputs.a) p.angle += TURN_SPEED * dir;
        if (inputs.d) p.angle -= TURN_SPEED * dir;
    }

    const fx = Math.sin(p.angle) * p.speed;
    const fz = Math.cos(p.angle) * p.speed;
    p.vx = p.vx * GRIP + fx * (1 - GRIP);
    p.vz = p.vz * GRIP + fz * (1 - GRIP);

    p.x += p.vx;
    p.z += p.vz;

    // Ghiaia: rallentamento fuori pista
    const dist = nearestTrackDist(p.x, p.z);
    if (dist > ROAD_HALF + 2) {
        const k = Math.min(1, (dist - ROAD_HALF - 2) / 8);  // 0..1 in funzione della profondità
        const drag = 0.04 + k * 0.08;
        p.speed *= (1 - drag);
        p.vx   *= (1 - drag);
        p.vz   *= (1 - drag);
    }
}

// ====================================================
// HELPERS
// ====================================================
function buildPublicState(players) {
    const out = {};
    for (const [color, p] of Object.entries(players)) {
        out[color] = {
            x: p.x, z: p.z, angle: p.angle,
            speed:    p.speed,
            finished: p.finished,
            time:     p.time,
            lap:      p.lap
        };
    }
    return out;
}

function resetPlayers(game) {
    let i = 0;
    for (const p of Object.values(game.players)) {
        const spawn = SPAWN_POINTS[i % SPAWN_POINTS.length];
        p.x = spawn.x; p.z = spawn.z; p.angle = spawn.angle;
        p.speed = 0; p.vx = 0; p.vz = 0;
        p.finished = false; p.time = null;
        p.lap = 0; p.checkpointA = false; p.inFinishZone = false;
        i++;
    }
}
