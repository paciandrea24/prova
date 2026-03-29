const { activeGames } = require('../store/activeGames');
const { lobbies } = require('../store/lobbies');

// Architettura Mappa a Grafo
const ROOM_CONFIG = {
    'Centro': { top: 'Nord', bottom: 'Sud', left: 'Ovest', right: 'Est' },
    'Nord': { bottom: 'Centro' },
    'Sud': { top: 'Centro' },
    'Est': { left: 'Centro' },
    'Ovest': { right: 'Centro' }
};

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;

// DEFINIZIONE DELLE TASK SULLA MAPPA
const ALL_TASKS = [
    { id: 'task_router', room: 'Nord', name: 'Riavvia Router', x: 400, y: 150 },
    { id: 'task_motori', room: 'Sud', name: 'Allinea Motore', x: 400, y: 450 },
    { id: 'task_dati', room: 'Est', name: 'Scarica Dati', x: 650, y: 300 },
    { id: 'task_spazzatura', room: 'Ovest', name: 'Svuota Spazzatura', x: 150, y: 300 },
    { id: 'task_id', room: 'Centro', name: 'Scansiona ID', x: 400, y: 200 }
];

function initializeGame(io, lobbyId, players, settings) {
    const numImpostors = parseInt(settings.impostors) || 1;
    let game = activeGames.get(lobbyId);

    if (game && game.loopInterval) {
        clearInterval(game.loopInterval);
    }

    const shuffled = [...players].sort(() => 0.5 - Math.random());
    const impostors = shuffled.slice(0, numImpostors);

    let totalGlobalTasks = 0;
    const playersState = {};

    players.forEach(color => {
        const isImpostor = impostors.includes(color);
        let myTasks = [];

        // Se è un Crewmate, gli diamo 3 task casuali
        if (!isImpostor) {
            const shuffledTasks = [...ALL_TASKS].sort(() => 0.5 - Math.random());
            myTasks = shuffledTasks.slice(0, 3).map(t => ({ ...t, completed: false }));
            totalGlobalTasks += myTasks.length;
        }

        playersState[color] = {
            color: color,
            room: 'Centro',
            x: CANVAS_WIDTH / 2,
            y: CANVAS_HEIGHT / 2,
            facing: 'down',
            isImpostor: isImpostor,
            isDead: false,
            tasks: myTasks
        };
    });

    game = {
        gameId: 'deduction',
        type: 'deduction',
        phase: 'starting',
        playersState: playersState,
        totalTasks: totalGlobalTasks,
        completedTasks: 0,
        loopInterval: null
    };

    activeGames.set(lobbyId, game);

    setTimeout(() => {
        const activeGame = activeGames.get(lobbyId);
        if (activeGame && activeGame.phase === 'starting') {
            activeGame.phase = 'exploration';
            io.to(lobbyId).emit('explorationStarted', {
                totalTasks: activeGame.totalTasks,
                completedTasks: activeGame.completedTasks
            });
            console.log(`🔪 Partita Deduction iniziata nella lobby ${lobbyId}`);
        }
    }, 6000);

    game.loopInterval = setInterval(() => {
        if (game.phase !== 'exploration') return;

        const rooms = Object.keys(ROOM_CONFIG);
        rooms.forEach(roomName => {
            const playersInRoom = {};
            for (let color in game.playersState) {
                if (game.playersState[color].room === roomName) {
                    playersInRoom[color] = {
                        color: game.playersState[color].color,
                        x: game.playersState[color].x,
                        y: game.playersState[color].y,
                        facing: game.playersState[color].facing,
                        isDead: game.playersState[color].isDead
                    };
                }
            }
            io.to(`${lobbyId}_${roomName}`).emit('gameState', playersInRoom);
        });
    }, 1000 / 30);

    return game;
}

function processMovement(io, socket, lobbyId, playerColor, x, y, facing) {
    const game = activeGames.get(lobbyId);
    if (!game || game.phase !== 'exploration') return;

    const player = game.playersState[playerColor];
    if (!player || player.isDead) return;

    player.x = x;
    player.y = y;
    player.facing = facing;

    let newRoom = null;
    if (player.x < 0 && ROOM_CONFIG[player.room].left) {
        newRoom = ROOM_CONFIG[player.room].left;
        player.x = CANVAS_WIDTH - 20;
    } else if (player.x > CANVAS_WIDTH && ROOM_CONFIG[player.room].right) {
        newRoom = ROOM_CONFIG[player.room].right;
        player.x = 20;
    } else if (player.y < 0 && ROOM_CONFIG[player.room].top) {
        newRoom = ROOM_CONFIG[player.room].top;
        player.y = CANVAS_HEIGHT - 20;
    } else if (player.y > CANVAS_HEIGHT && ROOM_CONFIG[player.room].bottom) {
        newRoom = ROOM_CONFIG[player.room].bottom;
        player.y = 20;
    }

    if (newRoom) {
        socket.leave(`${lobbyId}_${player.room}`);
        player.room = newRoom;
        socket.join(`${lobbyId}_${player.room}`);
        socket.emit('roomTransition', { newRoom, x: player.x, y: player.y });
    }
}

function processTask(io, socket, lobbyId, playerColor, taskId) {
    const game = activeGames.get(lobbyId);
    if (!game || game.phase !== 'exploration') return;

    const player = game.playersState[playerColor];
    if (!player || player.isDead || player.isImpostor) return;

    const task = player.tasks.find(t => t.id === taskId);

    // Controlla che la task esista, non sia completata e il giocatore sia nella stanza giusta
    if (task && !task.completed && player.room === task.room) {
        // Controllo distanza (sicurezza lato server)
        const dx = player.x - task.x;
        const dy = player.y - task.y;
        if (Math.sqrt(dx * dx + dy * dy) < 80) {
            task.completed = true;
            game.completedTasks++;

            // Aggiorna solo il giocatore sulla sua task
            socket.emit('taskCompleted', taskId);
            // Aggiorna tutti sulla barra globale
            io.to(lobbyId).emit('globalTaskProgress', {
                completedTasks: game.completedTasks,
                totalTasks: game.totalTasks
            });

            checkWinCondition(io, lobbyId);
        }
    }
}

function processKill(io, lobbyId, playerColor) {
    const game = activeGames.get(lobbyId);
    if (!game || game.phase !== 'exploration') return;

    const killer = game.playersState[playerColor];
    if (!killer || !killer.isImpostor || killer.isDead) return;

    for (let targetColor in game.playersState) {
        if (targetColor === playerColor) continue;
        const victim = game.playersState[targetColor];

        if (victim.room === killer.room && !victim.isDead && !victim.isImpostor) {
            const dx = victim.x - killer.x;
            const dy = victim.y - killer.y;

            if (Math.sqrt(dx * dx + dy * dy) < 100) {
                victim.isDead = true;

                // Rimuovi le task della vittima dal totale globale per non bloccare la vittoria
                const unfinishedTasks = victim.tasks.filter(t => !t.completed).length;
                game.totalTasks -= unfinishedTasks;

                io.to(`${lobbyId}_${killer.room}`).emit('playerKilled', targetColor);

                // Aggiorna la barra perché il totale è sceso
                io.to(lobbyId).emit('globalTaskProgress', {
                    completedTasks: game.completedTasks,
                    totalTasks: game.totalTasks
                });

                checkWinCondition(io, lobbyId);
                break;
            }
        }
    }
}

function checkWinCondition(io, lobbyId) {
    const game = activeGames.get(lobbyId);
    if (!game || game.phase !== 'exploration') return;

    let aliveImpostors = 0;
    let aliveCrewmates = 0;

    for (let color in game.playersState) {
        const p = game.playersState[color];
        if (!p.isDead) {
            if (p.isImpostor) aliveImpostors++;
            else aliveCrewmates++;
        }
    }

    const lobby = lobbies.get(lobbyId);
    const hostColor = lobby ? lobby.host : null;

    // Vittoria Impostori
    if (aliveImpostors >= aliveCrewmates) {
        game.phase = 'gameOver';
        clearInterval(game.loopInterval);
        io.to(lobbyId).emit('gameOver', { winner: 'impostors', hostColor });
    }
    // Vittoria Crewmates (Impostori morti OR Tutte le task finite)
    else if (aliveImpostors === 0 || (game.totalTasks > 0 && game.completedTasks >= game.totalTasks)) {
        game.phase = 'gameOver';
        clearInterval(game.loopInterval);
        io.to(lobbyId).emit('gameOver', { winner: 'crewmates', hostColor });
    }
}

module.exports = { initializeGame, processMovement, processKill, processTask };