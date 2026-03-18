const activeGames = require('../../store/activeGames');
const { lobbies } = require('../../store/lobbies');

const GAME_ID = 'footballMulti';
const gameLoops = {};

module.exports = function (io, socket) {

    socket.on('joinGame', (data) => {
        const { lobbyId, gameId, playerColor } = data;
        if (gameId !== GAME_ID) return;

        socket.join(lobbyId);
        socket.data.lobbyId = lobbyId;
        socket.data.playerColor = playerColor;

        const lobby = lobbies.get(lobbyId);
        if (!lobby) return;

        if (activeGames[lobbyId] && activeGames[lobbyId].gameOver) {
            if (gameLoops[lobbyId]) clearInterval(gameLoops[lobbyId]);
            delete activeGames[lobbyId];
        }

        if (!activeGames[lobbyId]) {
            activeGames[lobbyId] = {
                gameId: GAME_ID,
                status: 'playing',
                players: {},
                ball: { x: 500, y: 500, vx: 0, vy: 0, radius: 12, friction: 0.98 },
                arena: [],
                gameOver: false
            };
            startGameLoop(lobbyId, io);
        }

        const game = activeGames[lobbyId];

        if (!game.players[playerColor]) {
            game.players[playerColor] = {
                x: 500, y: 500, vx: 0, vy: 0,
                radius: 15, color: playerColor, team: 'player',
                speed: 2.5, friction: 0.85,
                lives: 3, eliminated: false,
                inputs: { up: false, down: false, left: false, right: false, kick: false },
                isKicking: false
            };
        }

        recalculateArena(game);
        socket.emit('matchStarted');
    });

    socket.on('playerInput', (keys) => {
        const lobbyId = socket.data.lobbyId;
        const color = socket.data.playerColor;
        const game = activeGames[lobbyId];
        if (game && game.players[color] && !game.players[color].eliminated) {
            game.players[color].inputs = keys;
        }
    });
};

function recalculateArena(game) {
    const activePlayers = Object.values(game.players).filter(p => p.team === 'player');
    game.arena = [];
    if (activePlayers.length < 3) return;

    const centerX = 500; const centerY = 500; const radius = 480;
    const angleStep = (Math.PI * 2) / activePlayers.length;
    const offset = Math.PI / 2;

    for (let i = 0; i < activePlayers.length; i++) {
        const angle = (i * angleStep) - offset;
        const p = activePlayers[i];

        game.arena.push({
            x: centerX + Math.cos(angle) * radius,
            y: centerY + Math.sin(angle) * radius,
            ownerColor: p.color,
            eliminated: p.eliminated
        });
    }
    resetMatchState(game);
}

function resetMatchState(game) {
    game.ball.x = 500; game.ball.y = 500; game.ball.vx = 0; game.ball.vy = 0;

    const activePlayers = Object.values(game.players).filter(p => p.team === 'player');
    const angleStep = (Math.PI * 2) / activePlayers.length;
    const offset = Math.PI / 2;
    const apothem = 480 * Math.cos(Math.PI / activePlayers.length);

    for (let i = 0; i < activePlayers.length; i++) {
        const p = activePlayers[i];
        if (!p.eliminated) {
            const angle = (i * angleStep) - offset;
            const midAngle = angle + (angleStep / 2);

            p.x = 500 + Math.cos(midAngle) * (apothem - 60);
            p.y = 500 + Math.sin(midAngle) * (apothem - 60);
            p.vx = 0;
            p.vy = 0;
        }
    }
}

function startGameLoop(lobbyId, io) {
    const game = activeGames[lobbyId];
    if (gameLoops[lobbyId]) clearInterval(gameLoops[lobbyId]);

    gameLoops[lobbyId] = setInterval(() => {
        if (game.gameOver) return;
        updateMultiPhysics(game, io, lobbyId);
        if (activeGames[lobbyId]) {
            io.to(lobbyId).emit('gameState', {
                players: game.players,
                ball: game.ball,
                arena: game.arena
            });
        }
    }, 1000 / 30);
}

function updateMultiPhysics(game, io, lobbyId) {
    const b = game.ball;
    const playersArr = Object.values(game.players).filter(p => p.team === 'player' && !p.eliminated);

    // 1. Movimento Base Giocatori
    for (let p of playersArr) {
        let moveX = 0; let moveY = 0;
        if (p.inputs.up) moveY -= 1;
        if (p.inputs.down) moveY += 1;
        if (p.inputs.left) moveX -= 1;
        if (p.inputs.right) moveX += 1;

        if (moveX !== 0 || moveY !== 0) {
            const mag = Math.sqrt(moveX * moveX + moveY * moveY);
            p.vx += (moveX / mag) * p.speed;
            p.vy += (moveY / mag) * p.speed;
        }

        p.isKicking = p.inputs.kick;
        p.vx *= p.friction; p.vy *= p.friction;
        p.x += p.vx; p.y += p.vy;
    }

    // 2. Collisioni Giocatore-Giocatore
    for (let i = 0; i < playersArr.length; i++) {
        for (let j = i + 1; j < playersArr.length; j++) {
            const p1 = playersArr[i];
            const p2 = playersArr[j];

            let dx = p2.x - p1.x; let dy = p2.y - p1.y;
            let dist = Math.sqrt(dx * dx + dy * dy);

            if (dist === 0) { dx = 1; dist = 1; }

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

    // 3. Movimento Palla 
    const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    if (speed > 16) { b.vx = (b.vx / speed) * 16; b.vy = (b.vy / speed) * 16; }

    b.vx *= b.friction; b.vy *= b.friction;
    b.x += b.vx; b.y += b.vy;

    // 4. Collisione Giocatore-Palla (Spostata PRIMA dei Muri)
    for (let p of playersArr) {
        let dx = b.x - p.x; let dy = b.y - p.y;
        let dist = Math.sqrt(dx * dx + dy * dy);

        if (dist === 0) { dx = 1; dist = 1; }

        if (dist < p.radius + b.radius) {
            let nx = dx / dist; let ny = dy / dist;
            let overlap = (p.radius + b.radius) - dist;
            b.x += nx * overlap; b.y += ny * overlap; // La palla viene spinta
            b.vx = p.vx + nx * 0.5; b.vy = p.vy + ny * 0.5;
        }

        if (p.isKicking && dist < p.radius + b.radius + 18) {
            let nx = dx / dist; let ny = dy / dist;
            b.vx += nx * 14; b.vy += ny * 14;
        }
    }

    // 5. Collisioni Giocatore-Muri (Il Poligono)
    for (let p of playersArr) {
        for (let i = 0; i < game.arena.length; i++) {
            const p1 = game.arena[i];
            const p2 = game.arena[(i + 1) % game.arena.length];

            const l2 = dist2(p1, p2);
            if (l2 == 0) continue;

            let t = ((p.x - p1.x) * (p2.x - p1.x) + (p.y - p1.y) * (p2.y - p1.y)) / l2;
            t = Math.max(0, Math.min(1, t));

            const closestX = p1.x + t * (p2.x - p1.x);
            const closestY = p1.y + t * (p2.y - p1.y);

            const dx = p.x - closestX;
            const dy = p.y - closestY;
            const distance = Math.sqrt(dx * dx + dy * dy);

            let nx = dx / (distance || 1);
            let ny = dy / (distance || 1);

            // FIX: Calcola se il giocatore è fisicamente "fuori" dal campo
            let toCenterX = 500 - closestX;
            let toCenterY = 500 - closestY;
            let isOutside = (nx * toCenterX + ny * toCenterY) < 0;

            if (distance < p.radius || (distance < 50 && isOutside)) {
                if (isOutside) { nx = -nx; ny = -ny; } // Inverti la normale verso il centro

                p.x = closestX + nx * p.radius;
                p.y = closestY + ny * p.radius;

                let dot = p.vx * nx + p.vy * ny;
                if (dot < 0) { p.vx -= dot * nx; p.vy -= dot * ny; }
            }
        }
    }

    // 6. Collisione Palla-Muri (con recupero Tunneling e GOAL)
    for (let i = 0; i < game.arena.length; i++) {
        const p1 = game.arena[i];
        const p2 = game.arena[(i + 1) % game.arena.length];

        const l2 = dist2(p1, p2);
        if (l2 == 0) continue;

        let t = ((b.x - p1.x) * (p2.x - p1.x) + (b.y - p1.y) * (p2.y - p1.y)) / l2;
        t = Math.max(0, Math.min(1, t));

        const closestX = p1.x + t * (p2.x - p1.x);
        const closestY = p1.y + t * (p2.y - p1.y);

        const dx = b.x - closestX;
        const dy = b.y - closestY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        let nx = dx / (distance || 1);
        let ny = dy / (distance || 1);

        // FIX TUNNELING: Calcoliamo se la palla ha sfondato il muro
        let toCenterX = 500 - closestX;
        let toCenterY = 500 - closestY;
        let isOutside = (nx * toCenterX + ny * toCenterY) < 0;

        // Catturiamo la palla se è dentro (normale collisione) OPPURE se è fuori per colpa di una spinta (max 50px)
        if (distance < b.radius || (distance < 50 && isOutside)) {

            // Assicuriamoci che la forza repulsiva del muro spinga sempre verso il centro!
            if (isOutside) { nx = -nx; ny = -ny; }

            const wallRatio = 0.30;
            const isGoalArea = t > wallRatio && t < (1 - wallRatio);

            if (!p1.eliminated && isGoalArea) {
                // GOAL
                const victim = game.players[p1.ownerColor];
                if (victim) {
                    victim.lives--;
                    if (victim.lives <= 0) {
                        victim.eliminated = true;
                        p1.eliminated = true;
                        checkWinCondition(game, io, lobbyId);
                    }
                }
                resetMatchState(game);
                break;
            } else {
                // RIMBALZO su Muro
                b.x = closestX + nx * b.radius;
                b.y = closestY + ny * b.radius;
                let dot = b.vx * nx + b.vy * ny;
                if (dot < 0) {
                    b.vx -= 2 * dot * nx;
                    b.vy -= 2 * dot * ny;
                    b.vx *= 0.8; b.vy *= 0.8;
                }
            }
        }
    }

    // 7. Sistema Anti-Glitch Assoluto (Se vola oltre i 600px la si resetta)
    const distFromCenter = Math.sqrt((b.x - 500) ** 2 + (b.y - 500) ** 2);
    if (distFromCenter > 600 || isNaN(b.x) || isNaN(b.y)) {
        resetMatchState(game);
    }
}

function dist2(v, w) { return (v.x - w.x) * (v.x - w.x) + (v.y - w.y) * (v.y - w.y); }

function checkWinCondition(game, io, lobbyId) {
    const activePlayers = Object.values(game.players).filter(p => !p.eliminated && p.team === 'player');

    if (activePlayers.length <= 1) {
        game.gameOver = true;
        const winnerColor = activePlayers.length === 1 ? activePlayers[0].color : 'Nessuno';
        const lobby = lobbies.get(lobbyId);
        const hostColor = lobby ? lobby.host : null;
        io.to(lobbyId).emit('gameOver', { winner: winnerColor, hostColor: hostColor });
    }
}