const { activeGames } = require('../store/activeGames');

const TILE_SIZE = 40;

// Mappa Fedele di Monza (27x53)
// 0 = Erba, 1 = Asfalto, 2 = Traguardo, 3 = Checkpoint (Variante Ascari)
const trackMap = [
  /* 0*/[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  /* 1*/[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  /* 2*/[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // Curve di Lesmo 1 e 2
  /* 3*/[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  /* 4*/[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  /* 5*/[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  /* 6*/[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], // Variante della Roggia
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
    console.log(`🏎️ Inizializzazione Racing per lobby ${lobbyId}`);

    const playersState = {};

    players.forEach((p, index) => {
        // Spaziatura per formare la griglia (2 auto per fila)
        const colOffset = index % 2 === 0 ? 0 : 45;
        const rowOffset = Math.floor(index / 2) * 40;

        // Spawn perfetto sul rettifilo d'arrivo, PRIMA del traguardo
        // Colonna 16 (X = 16 * 40 = 640)
        // Riga 23 (Y = 23 * 40 = 920)
        playersState[p] = {
            color: p,
            x: 640 + colOffset,
            y: 920 + rowOffset,
            angle: 0, // Muso rivolto verso Destra
            inputs: { w: false, a: false, s: false, d: false },
            passedCheckpoint: false,
            finished: false,
            place: null
        };
    });

    const game = {
        lobbyId,
        gameId: 'racing',
        players: [...players],
        playersState,
        trackMap: trackMap,
        tileSize: TILE_SIZE,
        podium: [],
        isActive: false,
        loopInterval: null
    };

    activeGames.set(lobbyId, game);
    return game;
}

function runGameLoop(io, lobbyId) {
    const game = activeGames.get(lobbyId);
    if (!game) return;

    const speed = 4;
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

            // Fisica vecchio stile: collisione basata sulla griglia
            let points = [
                { x: nextX, y: nextY },
                { x: nextX + carWidth, y: nextY },
                { x: nextX, y: nextY + carHeight },
                { x: nextX + carWidth, y: nextY + carHeight }
            ];

            let canMove = true;
            let isOnFinishLine = false;
            let isOnCheckpoint = false;

            for (let pt of points) {
                let col = Math.floor(pt.x / game.tileSize);
                let row = Math.floor(pt.y / game.tileSize);

                if (row < 0 || row >= game.trackMap.length || col < 0 || col >= game.trackMap[0].length) {
                    canMove = false;
                    break;
                }

                let tile = game.trackMap[row][col];
                if (tile === 0) {
                    canMove = false; // Erba, non ci si muove
                    break;
                }
                if (tile === 2) isOnFinishLine = true;
                if (tile === 3) isOnCheckpoint = true;
            }

            if (canMove) {
                pState.x = nextX;
                pState.y = nextY;

                if (isOnCheckpoint) pState.passedCheckpoint = true;

                if (isOnFinishLine && pState.passedCheckpoint) {
                    pState.finished = true;
                    game.podium.push(color);
                    pState.place = game.podium.length;
                    io.to(lobbyId).emit('message', {
                        message: `🏎️ ${color} è arrivato al ${pState.place}° posto!`,
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

        if (game.podium.length === 3 || everyoneFinished) {
            endRace(io, lobbyId);
        }
    }, 1000 / 120); // 120 FPS mantenuti!
}

function updatePlayerInput(lobbyId, playerColor, inputs) {
    const game = activeGames.get(lobbyId);
    if (game && game.playersState[playerColor] && game.isActive) game.playersState[playerColor].inputs = inputs;
}
function startRace(io, lobbyId) {
    const game = activeGames.get(lobbyId);
    if (!game) return;
    game.isActive = true;
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