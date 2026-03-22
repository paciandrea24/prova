// backend/sockets/games/footballGameSocket.js
const { activeGames } = require('../../store/activeGames'); // <-- FIX: Estratto correttamente
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

        // FIX: Pulisce sessioni precedenti se qualcuno era rimasto incastrato
        const existingGame = activeGames.get(lobbyId);
        if (existingGame && existingGame.gameOver) {
            if (gameLoops[lobbyId]) clearInterval(gameLoops[lobbyId]);
            activeGames.delete(lobbyId);
        }

        if (!activeGames.has(lobbyId)) {
            const maxG = parseInt(lobby.lastGameSettings['maxGoals']) || 3;
            const initialStatus = lobby.players.length > 2 ? 'setup' : 'playing';

            activeGames.set(lobbyId, {
                gameId: GAME_ID,
                status: initialStatus,
                maxGoals: maxG,
                players: {},
                ball: { x: 400, y: 200, vx: 0, vy: 0, radius: 10, friction: 0.96 },
                score: {},
                gameOver: false,
                kickoffTeam: null
            });

            const game = activeGames.get(lobbyId);
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

        const game = activeGames.get(lobbyId);

        // [FIX CRITICO]: Se un giocatore entra dopo o ricarica la pagina, aggiungiamolo al volo
        if (!game.players[playerColor]) {
            let team = 'spectator';
            if (game.status === 'setup' || game.status === 'playing') {
                const hasLeft = Object.values(game.players).some(p => p.team === 'left');
                const hasRight = Object.values(game.players).some(p => p.team === 'right');
                if (!hasLeft) team = 'left';
                else if (!hasRight) team = 'right';
            }

            game.players[playerColor] = {
                x: team === 'left' ? 200 : (team === 'right' ? 600 : -100),
                y: 200,
                vx: 0, vy: 0,
                radius: 15,
                color: playerColor,
                team: team,
                speed: 1.8,
                friction: 0.85,
                inputs: { up: false, down: false, left: false, right: false, kick: false },
                isKicking: false
            };
            if (team !== 'spectator') game.score[playerColor] = 0;
        }

        // Notifica il client che è tutto pronto per renderizzare
        if (game.status === 'setup') {
            socket.emit('setupState', { players: game.players, host: lobby.host });
        } else if (game.status === 'playing') {
            socket.emit('matchStarted');
        }
    });

    socket.on('switchTeam', (newTeam) => {
        const lobbyId = socket.data.lobbyId;
        const color = socket.data.playerColor;
        const game = activeGames.get(lobbyId);

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

    socket.on('confirmSetup', () => {
        const lobbyId = socket.data.lobbyId;
        const color = socket.data.playerColor;
        const game = activeGames.get(lobbyId);
        const lobby = lobbies.get(lobbyId);

        if (!game || game.status !== 'setup' || lobby.host !== color) return;
        const hasLeft = Object.values(game.players).some(p => p.team === 'left');
        const hasRight = Object.values(game.players).some(p => p.team === 'right');
        if (!hasLeft || !hasRight) return;

        game.status = 'playing';

        game.ball.x = 400; game.ball.y = 200; game.ball.vx = 0; game.ball.vy = 0;
        game.score = {};

        for (let c in game.players) {
            const p = game.players[c];
            if (p.team !== 'spectator') {
                game.score[c] = 0;
                p.x = p.team === 'left' ? 200 : 600;
                p.y = 200;
                p.vx = 0; p.vy = 0;
            } else {
                p.x = -100;
                p.y = -100;
                p.vx = 0; p.vy = 0;
            }
        }

        io.to(lobbyId).emit('matchStarted');
        startGameLoop(lobbyId, io);
    });

    socket.on('restartGameRequest', (data) => {
        const { lobbyId } = data;
        const game = activeGames.get(lobbyId);
        if (!lobbyId || !game || !game.gameOver) return;

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
        const game = activeGames.get(lobbyId);

        if (!lobbyId || !color || !game || game.gameId !== GAME_ID || game.gameOver) return;

        if (game.players && game.players[color] && game.players[color].team !== 'spectator') {
            game.players[color].inputs = keys;
        }
    });
};

function startGameLoop(lobbyId, io) {
    const game = activeGames.get(lobbyId);
    if (gameLoops[lobbyId]) clearInterval(gameLoops[lobbyId]);

    gameLoops[lobbyId] = setInterval(() => {
        // FIX: Se la partita è stata eliminata (rientro in lobby), spegni il server loop fisico
        if (!activeGames.has(lobbyId)) {
            clearInterval(gameLoops[lobbyId]);
            delete gameLoops[lobbyId];
            return;
        }

        if (game.gameOver) return;
        updatePhysics(game, io, lobbyId);
        io.to(lobbyId).emit('gameState', {
            players: game.players,
            ball: game.ball,
            score: game.score,
            gameOver: game.gameOver
        });
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

        // Muri esterni per i giocatori
        if (p.x < p.radius) p.x = p.radius;
        if (p.x > 800 - p.radius) p.x = 800 - p.radius;
        if (p.y < p.radius) p.y = p.radius;
        if (p.y > 400 - p.radius) p.y = 400 - p.radius;

        // Muro invisibile del fischio d'inizio
        if (game.kickoffTeam) {
            const keepOutDistance = 60 + p.radius;

            if (game.kickoffTeam === 'left' && p.team === 'right' && p.x < 400 + keepOutDistance) {
                p.x = 400 + keepOutDistance;
                p.vx = 0;
            }
            else if (game.kickoffTeam === 'right' && p.team === 'left' && p.x > 400 - keepOutDistance) {
                p.x = 400 - keepOutDistance;
                p.vx = 0;
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

    // 3. Fisica Palla (Sub-stepping per anti-tunneling)
    b.vx *= b.friction;
    b.vy *= b.friction;

    for (let step = 0; step < 2; step++) {
        b.x += b.vx / 2;
        b.y += b.vy / 2;

        if (b.y < b.radius) { b.y = b.radius; b.vy *= -1; }
        if (b.y > 400 - b.radius) { b.y = 400 - b.radius; b.vy *= -1; }

        const inGoalY = (b.y > 130 && b.y < 270);
        if (b.x < b.radius) {
            if (inGoalY) { goalScored(game, 'left', io, lobbyId); return; }
            else { b.x = b.radius; b.vx *= -1; }
        }
        if (b.x > 800 - b.radius) {
            if (inGoalY) { goalScored(game, 'right', io, lobbyId); return; }
            else { b.x = 800 - b.radius; b.vx *= -1; }
        }

        // 4. Collisione Giocatore-Palla (Fase A: Dribbling e Rimbalzi)
        let pushX = 0, pushY = 0;
        let newVx = 0, newVy = 0;
        let touchCount = 0;

        for (let color in game.players) {
            const p = game.players[color];
            if (p.team === 'spectator') continue;

            let dx = b.x - p.x; let dy = b.y - p.y;
            let dist = Math.sqrt(dx * dx + dy * dy);
            if (dist === 0) { dx = 1; dist = 1; }

            if (dist < p.radius + b.radius) {
                let nx = dx / dist; let ny = dy / dist;
                let overlap = (p.radius + b.radius) - dist;

                // Accumula le forze invece di sovrascriverle
                pushX += nx * overlap;
                pushY += ny * overlap;
                newVx += p.vx + nx * 0.5;
                newVy += p.vy + ny * 0.5;
                touchCount++;

                if (game.kickoffTeam && p.team === game.kickoffTeam) {
                    game.kickoffTeam = null;
                }
            }
        }

        // Applica le forze fisiche mediate
        if (touchCount > 0) {
            b.x += pushX;
            b.y += pushY;
            b.vx = newVx / touchCount;
            b.vy = newVy / touchCount;
        }
    }

    // 5. Fase B: Calci (Si sommano)
    for (let color in game.players) {
        const p = game.players[color];
        if (p.team === 'spectator') continue;

        let dx = b.x - p.x; let dy = b.y - p.y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist === 0) { dx = 1; dist = 1; }

        if (p.isKicking && dist < p.radius + b.radius + 12) {
            let nx = dx / dist; let ny = dy / dist;
            b.vx += nx * 12; b.vy += ny * 12;

            if (game.kickoffTeam && p.team === game.kickoffTeam) {
                game.kickoffTeam = null;
            }
        }
    }

    // 6. Fase C: Limite di velocità finale
    const ballSpeed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    if (ballSpeed > 16) {
        b.vx = (b.vx / ballSpeed) * 16;
        b.vy = (b.vy / ballSpeed) * 16;
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
        const lobby = lobbies.get(lobbyId);
        const hostColor = lobby ? lobby.host : null;
        io.to(lobbyId).emit('gameOver', { winner: winnerFound, finalScore: game.score, hostColor: hostColor });
        return;
    }

    // Resetta le posizioni se la partita continua
    game.ball.x = 400; game.ball.y = 200; game.ball.vx = 0; game.ball.vy = 0;

    game.kickoffTeam = goalSide;

    // --- FIX: Se la squadra che deve battere è vuota (giocatore singolo o disconnesso), sblocca il calcio d'inizio ---
    const isKickoffTeamPresent = Object.values(game.players).some(p => p.team === game.kickoffTeam);
    if (!isKickoffTeamPresent) {
        game.kickoffTeam = null;
    }

    for (let color in game.players) {
        const p = game.players[color];
        if (p.team !== 'spectator') {
            p.x = p.team === 'left' ? 200 : 600;
            p.y = 200;
            p.vx = 0; p.vy = 0;
        }
    }
}