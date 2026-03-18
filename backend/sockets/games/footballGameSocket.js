// backend/sockets/games/footballGameSocket.js
const activeGames = require('../../store/activeGames');
const { lobbies } = require('../../store/lobbies');

const GAME_ID = 'football';
const gameLoops = {};

module.exports = function (io, socket) {

    socket.on('startGame', (data) => {
        const { lobbyId, gameId, settings } = data;
        if (gameId !== GAME_ID) return;

        const lobby = lobbies.get(lobbyId);
        if (!lobby) return;

        lobby.lastGameSettings = settings || {};

        const playerCount = lobby.players.length || lobby.players.size || Object.keys(lobby.players).length;

        // TRUCCO: Se ci sono più di 2 giocatori, cambiamo l'ID in 'footballMulti'
        // Così il frontend reindirizzerà a footballMulti.html invece di football.html
        const actualGameId = playerCount > 2 ? 'footballMulti' : 'football';

        io.to(lobbyId).emit('gameSelected', { gameId: actualGameId, settings });
        io.to(lobbyId).emit('message', { message: 'Il match sta per iniziare!', type: 'system' });
    });

    socket.on('joinGame', (data) => {
        const { lobbyId, gameId, playerColor } = data;
        if (gameId !== GAME_ID) return;

        socket.join(lobbyId);
        socket.data.lobbyId = lobbyId;
        socket.data.playerColor = playerColor;

        const lobby = lobbies.get(lobbyId);
        if (!lobby) return;

        if (!activeGames[lobbyId]) {
            const maxG = parseInt(lobby.lastGameSettings['maxGoals']) || 3;
            const initialStatus = lobby.players.length > 2 ? 'setup' : 'playing';

            activeGames[lobbyId] = {
                gameId: GAME_ID,
                status: initialStatus,
                maxGoals: maxG,
                players: {},
                ball: { x: 400, y: 200, vx: 0, vy: 0, radius: 10, friction: 0.96 },
                score: {},
                gameOver: false,
                kickoffTeam: null
            };

            const game = activeGames[lobbyId];
            let assignedLeft = false;
            let assignedRight = false;

            lobby.players.forEach(pColor => {
                let team = 'spectator';
                if (!assignedLeft) { team = 'left'; assignedLeft = true; }
                else if (!assignedRight) { team = 'right'; assignedRight = true; }

                game.players[pColor] = {
                    x: team === 'left' ? 200 : (team === 'right' ? 600 : -100),
                    y: 200,
                    vx: 0, vy: 0,
                    radius: 15,
                    color: pColor,
                    team: team,
                    speed: 1.8,
                    friction: 0.85,
                    inputs: { up: false, down: false, left: false, right: false, kick: false },
                    isKicking: false
                };
                if (team !== 'spectator') game.score[pColor] = 0;
            });

            if (game.status === 'playing') {
                startGameLoop(lobbyId, io);
            }
        }

        if (activeGames[lobbyId].status === 'setup') {
            socket.emit('setupState', { players: activeGames[lobbyId].players, host: lobby.host });
        }
    });

    socket.on('switchTeam', (newTeam) => {
        const lobbyId = socket.data.lobbyId;
        const color = socket.data.playerColor;
        const game = activeGames[lobbyId];

        if (!game || game.status !== 'setup') return;

        if (newTeam === 'left' || newTeam === 'right') {
            const isOccupied = Object.values(game.players).some(p => p.team === newTeam);
            if (isOccupied) return;
        }

        if (game.players[color]) {
            game.players[color].team = newTeam;
            io.to(lobbyId).emit('setupState', { players: game.players, host: lobbies.get(lobbyId).host });
        }
    });

    // CORREZIONE BUG POSIZIONAMENTO
    socket.on('confirmSetup', () => {
        const lobbyId = socket.data.lobbyId;
        const color = socket.data.playerColor;
        const game = activeGames[lobbyId];
        const lobby = lobbies.get(lobbyId);

        if (!game || game.status !== 'setup' || lobby.host !== color) return;
        const hasLeft = Object.values(game.players).some(p => p.team === 'left');
        const hasRight = Object.values(game.players).some(p => p.team === 'right');
        if (!hasLeft || !hasRight) return;

        game.status = 'playing';

        // Resetta la palla
        game.ball.x = 400; game.ball.y = 200; game.ball.vx = 0; game.ball.vy = 0;
        game.score = {};

        // Forza le coordinate fisiche corrette per tutti i giocatori in base al team scelto
        for (let c in game.players) {
            const p = game.players[c];
            if (p.team !== 'spectator') {
                game.score[c] = 0;
                p.x = p.team === 'left' ? 200 : 600; // Posizione sui blocchi di partenza
                p.y = 200;
                p.vx = 0; p.vy = 0;
            } else {
                p.x = -100; // Spettatori bloccati fuori schermo
                p.y = -100;
                p.vx = 0; p.vy = 0;
            }
        }

        io.to(lobbyId).emit('matchStarted');
        startGameLoop(lobbyId, io);
    });

    socket.on('restartGameRequest', (data) => {
        const { lobbyId } = data;
        if (!lobbyId || !activeGames[lobbyId] || !activeGames[lobbyId].gameOver) return;

        const game = activeGames[lobbyId];
        game.gameOver = false;
        game.ball = { x: 400, y: 200, vx: 0, vy: 0, radius: 10, friction: 0.96 };
        game.kickoffTeam = null;

        for (let color in game.score) { game.score[color] = 0; }

        for (let color in game.players) {
            const p = game.players[color];
            if (p.team !== 'spectator') {
                p.x = p.team === 'left' ? 200 : 600;
                p.y = 200;
                p.vx = 0; p.vy = 0;
            } else {
                p.x = -100; p.y = -100;
            }
            p.inputs = { up: false, down: false, left: false, right: false, kick: false };
            p.isKicking = false;
        }

        io.to(lobbyId).emit('gameRestarted');
    });

    socket.on('playerInput', (keys) => {
        const lobbyId = socket.data.lobbyId;
        const color = socket.data.playerColor;

        if (!lobbyId || !color || !activeGames[lobbyId] || activeGames[lobbyId].gameId !== GAME_ID || activeGames[lobbyId].gameOver) return;

        const game = activeGames[lobbyId];
        if (game.players && game.players[color] && game.players[color].team !== 'spectator') {
            game.players[color].inputs = keys;
        }
    });
};

function startGameLoop(lobbyId, io) {
    const game = activeGames[lobbyId];
    if (gameLoops[lobbyId]) clearInterval(gameLoops[lobbyId]);
    gameLoops[lobbyId] = setInterval(() => {
        if (game.gameOver) return;
        updatePhysics(game, io, lobbyId);
        if (activeGames[lobbyId]) {
            io.to(lobbyId).emit('gameState', {
                players: game.players,
                ball: game.ball,
                score: game.score,
                gameOver: game.gameOver
            });
        }
    }, 1000 / 30);
}

function updatePhysics(game, io, lobbyId) {
    const b = game.ball;

    // 1. Movimento Giocatori
    for (let color in game.players) {
        const p = game.players[color];
        if (p.team === 'spectator') continue;

        // Calcola la direzione desiderata (valori da -1 a 1)
        let moveX = 0;
        let moveY = 0;

        if (p.inputs.up) moveY -= 1;
        if (p.inputs.down) moveY += 1;
        if (p.inputs.left) moveX -= 1;
        if (p.inputs.right) moveX += 1;

        // Se c'è movimento, normalizza il vettore
        if (moveX !== 0 || moveY !== 0) {
            const magnitude = Math.sqrt(moveX * moveX + moveY * moveY);
            const normalizedX = moveX / magnitude;
            const normalizedY = moveY / magnitude;

            p.vx += normalizedX * p.speed;
            p.vy += normalizedY * p.speed;
        }

        p.isKicking = p.inputs.kick;

        p.vx *= p.friction;
        p.vy *= p.friction;
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < p.radius) p.x = p.radius;
        if (p.x > 800 - p.radius) p.x = 800 - p.radius;
        if (p.y < p.radius) p.y = p.radius;
        if (p.y > 400 - p.radius) p.y = 400 - p.radius;

        if (game.kickoffTeam) {
            // Il cerchio centrale ha raggio 60. Aggiungiamo il raggio del giocatore per tenerlo completamente fuori.
            const keepOutDistance = 60 + p.radius;

            // Se tocca al team sinistro battere, il team destro deve stare fuori dal cerchio di centrocampo
            if (game.kickoffTeam === 'left' && p.team === 'right' && p.x < 400 + keepOutDistance) {
                p.x = 400 + keepOutDistance;
                p.vx = 0; // Ferma lo slancio
            }
            // Se tocca al team destro battere, il team sinistro deve stare fuori dal cerchio di centrocampo
            else if (game.kickoffTeam === 'right' && p.team === 'left' && p.x > 400 - keepOutDistance) {
                p.x = 400 - keepOutDistance;
                p.vx = 0; // Ferma lo slancio
            }
        }
    }

    // 2. Collisioni tra Giocatori
    const playersArr = Object.values(game.players).filter(p => p.team !== 'spectator');
    for (let i = 0; i < playersArr.length; i++) {
        for (let j = i + 1; j < playersArr.length; j++) {
            const p1 = playersArr[i];
            const p2 = playersArr[j];

            let dx = p2.x - p1.x;
            let dy = p2.y - p1.y;
            let dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < p1.radius + p2.radius) {
                let nx = dx / dist; let ny = dy / dist;
                let overlap = (p1.radius + p2.radius) - dist;
                p1.x -= nx * (overlap / 2); p1.y -= ny * (overlap / 2);
                p2.x += nx * (overlap / 2); p2.y += ny * (overlap / 2);

                let relVx = p2.vx - p1.vx; let relVy = p2.vy - p1.vy;
                let relVelNormal = relVx * nx + relVy * ny;

                if (relVelNormal < 0) {
                    let restitution = 0.5;
                    let impulse = (-(1 + restitution) * relVelNormal) / 2;
                    p1.vx -= impulse * nx; p1.vy -= impulse * ny;
                    p2.vx += impulse * nx; p2.vy += impulse * ny;
                }
            }
        }
    }

    // 3. Fisica Palla
    b.vx *= b.friction;
    b.vy *= b.friction;
    b.x += b.vx;
    b.y += b.vy;

    if (b.y < b.radius) { b.y = b.radius; b.vy *= -1; }
    if (b.y > 400 - b.radius) { b.y = 400 - b.radius; b.vy *= -1; }

    const inGoalY = (b.y > 130 && b.y < 270);
    if (b.x < b.radius) {
        if (inGoalY) goalScored(game, 'left', io, lobbyId);
        else { b.x = b.radius; b.vx *= -1; }
    }
    if (b.x > 800 - b.radius) {
        if (inGoalY) goalScored(game, 'right', io, lobbyId);
        else { b.x = 800 - b.radius; b.vx *= -1; }
    }

    // 4. Collisione Giocatore-Palla
    for (let color in game.players) {
        const p = game.players[color];
        if (p.team === 'spectator') continue;

        let dx = b.x - p.x; let dy = b.y - p.y;
        let dist = Math.sqrt(dx * dx + dy * dy);

        let hasTouchedBall = false; // NUOVO FLAG

        if (dist < p.radius + b.radius) {
            let nx = dx / dist; let ny = dy / dist;
            let overlap = (p.radius + b.radius) - dist;
            b.x += nx * overlap; b.y += ny * overlap;
            b.vx = p.vx + nx * 0.5; b.vy = p.vy + ny * 0.5;
            hasTouchedBall = true;
        }

        if (p.isKicking && dist < p.radius + b.radius + 12) {
            let nx = dx / dist; let ny = dy / dist;
            b.vx += nx * 12; b.vy += ny * 12;
            hasTouchedBall = true;
        }

        // NUOVO: Rimuovi il muro invisibile appena la squadra autorizzata tocca o calcia la palla
        if (hasTouchedBall && game.kickoffTeam && p.team === game.kickoffTeam) {
            game.kickoffTeam = null;
        }
    }
}

// CORREZIONE BUG GOL (Calcolo standard come nel vero calcio)
function goalScored(game, goalSide, io, lobbyId) {
    // Se la palla entra a Sinistra, il punto va alla squadra Destra e viceversa
    const scoringTeam = goalSide === 'left' ? 'right' : 'left';
    let winnerFound = null;

    // Assegna il punto al giocatore di quella squadra
    for (let color in game.players) {
        const p = game.players[color];
        if (p.team === scoringTeam) {
            game.score[color]++;

            if (game.score[color] >= game.maxGoals) {
                winnerFound = color;
            }
        }
    }

    if (winnerFound) {
        game.gameOver = true;
        io.to(lobbyId).emit('gameOver', { winner: winnerFound, finalScore: game.score });
        return;
    }

    // Resetta le posizioni se la partita continua
    game.ball.x = 400; game.ball.y = 200; game.ball.vx = 0; game.ball.vy = 0;

    game.kickoffTeam = goalSide;

    for (let color in game.players) {
        const p = game.players[color];
        if (p.team !== 'spectator') {
            p.x = p.team === 'left' ? 200 : 600;
            p.y = 200;
            p.vx = 0; p.vy = 0;
        }
    }
}