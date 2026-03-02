const { activeGames } = require('../store/activeGames');

const TILE_SIZE = 80;

// Mappa Fedele di Monza (27x53)
// 0 = Erba, 1 = Asfalto, 2 = Traguardo, 3 = Checkpoint (Variante Ascari)
const trackMap = [
  /* 0*/[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  /* 1*/[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  /* 2*/[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // Curve di Lesmo 1 e 2
  /* 3*/[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  /* 4*/[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  /*5*/[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  /* 6*/[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 6, 6, 6, 6, 6, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // <--- SETTORE 1 QUI (I numeri 6)
  /* 7*/[0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  /* 8*/[0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  /* 9*/[0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // Curva Grande
  /*10*/[0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  /*11*/[0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // Curva del Serraglio
  /*12*/[0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  /*13*/[0, 0, 0, 3, 3, 3, 3, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // Variante Ascari (Checkpoints!)
  /*14*/[0, 0, 0, 1, 3, 3, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // Variante Ascari
  /*15*/[0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  /*16*/[0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  /*17*/[0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // Prima Variante
  /*18*/[0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  /*19*/[0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // Ingresso Parabolica
  /*20*/[0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  /*21*/[0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // Uscita Parabolica
  /*22*/[0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // TRAGUARDO (Rettilineo Arrivo)
  /*23*/[0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // TRAGUARDO
  /*24*/[0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // TRAGUARDO
  /*25*/[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  /*26*/[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
];

function initializeRacingGame(lobbyId, players, settings) {
    console.log(`🏎️ Inizializzazione Racing per lobby ${lobbyId} (Partenza Trackmania)`);

    const playersState = {};

    // Punto di spawn unico per tutti i giocatori!
    // Colonna 18 (X = 1440), a metà esatta tra la riga 22 e 23 (Y = 1800)
    const startX = 1440;
    const startY = 1800;

    players.forEach((p) => {
        playersState[p] = {
            color: p,
            x: startX,
            y: startY,
            angle: 0,
            inputs: { w: false, a: false, s: false, d: false },
            progress: 0, // <--- SOSTITUISCE passedCheckpoint
            finished: false,
            place: null,
            time: null
        };
    });

    const game = {
        lobbyId,
        gameId: 'racing',
        players: [...players],
        playersState,
        trackMap: trackMap,
        tileSize: TILE_SIZE, // Usa il tuo TILE_SIZE (80)
        podium: [],
        isActive: false,
        startTime: null,
        loopInterval: null
    };

    activeGames.set(lobbyId, game);
    return game;
}

function runGameLoop(io, lobbyId) {
    const game = activeGames.get(lobbyId);
    if (!game) return;

    // Velocità raddoppiata (es. da 9 a 18) per compensare i 60 FPS
    const speed = 18;
    const carWidth = 60;
    const carHeight = 30;

    game.loopInterval = setInterval(() => {
        if (!game.isActive) return;

        let everyoneFinished = true;

        for (const [color, pState] of Object.entries(game.playersState)) {
            if (pState.finished) continue;
            everyoneFinished = false;

            let dx = 0;
            let dy = 0;

            if (pState.inputs.w) dy -= speed;
            if (pState.inputs.s) dy += speed;
            if (pState.inputs.a) dx -= speed;
            if (pState.inputs.d) dx += speed;

            let nextX = pState.x + dx;
            let nextY = pState.y + dy;

            let points = [
                { x: nextX, y: nextY },
                { x: nextX + carWidth, y: nextY },
                { x: nextX, y: nextY + carHeight },
                { x: nextX + carWidth, y: nextY + carHeight }
            ];

            // Nuove variabili per i settori
            let canMove = true;
            let hitSector1 = false;
            let hitSector2 = false;
            let isOnFinishLine = false;

            for (let pt of points) {
                let col = Math.floor(pt.x / game.tileSize);
                let row = Math.floor(pt.y / game.tileSize);

                if (row < 0 || row >= game.trackMap.length || col < 0 || col >= game.trackMap[0].length) {
                    canMove = false;
                    break;
                }

                let tile = game.trackMap[row][col];

                if (tile === 0 || tile === 4 || tile === 5) {
                    canMove = false; // Erba e ostacoli
                    break;
                }

                // Controlla cosa stiamo toccando
                if (tile === 6) hitSector1 = true;
                if (tile === 3) hitSector2 = true;
                if (tile === 2) isOnFinishLine = true;
            }

            if (canMove) {
                pState.x = nextX;
                pState.y = nextY;

                // SISTEMA ANTI-CHEAT: Ordine obbligatorio dei settori
                if (hitSector1 && pState.progress === 0) {
                    pState.progress = 1; // Ha passato il primo!
                }
                if (hitSector2 && pState.progress === 1) {
                    pState.progress = 2; // Ha passato il secondo!
                }

                // TRAGUARDO (Gara finita solo se progress è 2)
                if (isOnFinishLine && pState.progress === 2) {
                    pState.finished = true;
                    pState.progress = 3; // Evita trigger multipli

                    const lapTimeMs = Date.now() - game.startTime;
                    pState.time = lapTimeMs;

                    game.podium.push({ color: color, time: lapTimeMs });
                    pState.place = game.podium.length;

                    const mins = Math.floor(lapTimeMs / 60000);
                    const secs = Math.floor((lapTimeMs % 60000) / 1000);
                    const ms = lapTimeMs % 1000;
                    const formatted = `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;

                    io.to(lobbyId).emit('message', {
                        message: `🏁 ${color} ha tagliato il traguardo in ${formatted} (${pState.place}° posto)`,
                        type: 'success'
                    });
                }
            }

            if (dx !== 0 || dy !== 0) {
                let targetAngle = Math.atan2(dy, dx) * (180 / Math.PI);
                let diff = targetAngle - pState.angle;
                while (diff <= -180) diff += 360;
                while (diff > 180) diff -= 360;
                pState.angle += diff;
            }
        }

        io.to(lobbyId).emit('racingStateUpdate', game.playersState);

        // NUOVA CONDIZIONE DI FINE: Si ferma SOLO quando tutti hanno finito!
        if (everyoneFinished && game.players.length > 0) {
            endRace(io, lobbyId);
        }
    }, 1000 / 60); // <--- DA 120 A 60 FPS!
}

function updatePlayerInput(lobbyId, playerColor, inputs) {
    const game = activeGames.get(lobbyId);
    if (game && game.playersState[playerColor] && game.isActive) game.playersState[playerColor].inputs = inputs;
}

function startRace(io, lobbyId) {
    const game = activeGames.get(lobbyId);
    if (!game) return;
    game.isActive = true;
    game.startTime = Date.now(); // <--- FA PARTIRE IL CRONOMETRO!
    io.to(lobbyId).emit('raceStarted');
    runGameLoop(io, lobbyId);
}

function endRace(io, lobbyId) {
    const game = activeGames.get(lobbyId);
    if (!game) return;
    game.isActive = false;
    clearInterval(game.loopInterval);
    io.to(lobbyId).emit('raceEnded', { podium: game.podium });
    setTimeout(() => {
        activeGames.delete(lobbyId);
        io.to(lobbyId).emit('returnToLobby');
    }, 10000);
}

module.exports = { initializeRacingGame, updatePlayerInput, startRace };