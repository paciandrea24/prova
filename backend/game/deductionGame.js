const { activeGames } = require('../store/activeGames');
const { lobbies } = require('../store/lobbies');
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;

// DEFINIZIONE DELLE TASK SULLA MAPPA
// backend/game/deductionGame.js

// Architettura Mappa a Grafo (Griglia 3x3)
const ROOM_CONFIG = {
    'Centro': { top: 'Nord', bottom: 'Sud', left: 'Ovest', right: 'Est' },
    'Nord': { bottom: 'Centro', left: 'Nord-Ovest', right: 'Nord-Est' },
    'Sud': { top: 'Centro', left: 'Sud-Ovest', right: 'Sud-Est' },
    'Est': { left: 'Centro', top: 'Nord-Est', bottom: 'Sud-Est' },
    'Ovest': { right: 'Centro', top: 'Nord-Ovest', bottom: 'Sud-Ovest' },

    // NUOVE STANZE AGLI ANGOLI
    'Nord-Ovest': { right: 'Nord', bottom: 'Ovest' },
    'Nord-Est': { left: 'Nord', bottom: 'Est' },
    'Sud-Ovest': { right: 'Sud', top: 'Ovest' },
    'Sud-Est': { left: 'Sud', top: 'Est' }
};

// Aggiungiamo 4 nuove task nelle nuove stanze (totale 9 task)
const ALL_TASKS = [
    { id: 'task_router', room: 'Nord', name: 'Riavvia Router', x: 400, y: 150 },
    { id: 'task_motori', room: 'Sud', name: 'Allinea Motore', x: 400, y: 450 },
    { id: 'task_dati', room: 'Est', name: 'Scarica Dati', x: 650, y: 300 },
    { id: 'task_spazzatura', room: 'Ovest', name: 'Svuota Spazzatura', x: 150, y: 300 },
    { id: 'task_id', room: 'Centro', name: 'Scansiona ID', x: 400, y: 200 },

    // NUOVE TASK
    { id: 'task_scudi', room: 'Nord-Ovest', name: 'Attiva Scudi', x: 200, y: 200 },
    { id: 'task_armi', room: 'Nord-Est', name: 'Carica Armi', x: 600, y: 200 },
    { id: 'task_ossigeno', room: 'Sud-Ovest', name: 'Filtra Ossigeno', x: 200, y: 400 },
    { id: 'task_navigazione', room: 'Sud-Est', name: 'Mappa Rotta', x: 600, y: 400 }
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

// Aggiungi questo in cima con le altre dichiarazioni
let meetingTimers = {}; // Per tracciare i timer dei meeting

// --- NUOVE FUNZIONI DA AGGIUNGERE ---

function processReport(io, lobbyId, reporterColor) {
    const game = activeGames.get(lobbyId);
    if (!game || game.phase !== 'exploration') return;

    const reporter = game.playersState[reporterColor];
    if (!reporter || reporter.isDead) return;

    // Cerca un cadavere nella stessa stanza vicino al reporter
    let bodyFound = false;
    for (let color in game.playersState) {
        const p = game.playersState[color];
        if (p.isDead && p.room === reporter.room) {
            const dx = p.x - reporter.x;
            const dy = p.y - reporter.y;
            if (Math.sqrt(dx * dx + dy * dy) < 100) {
                bodyFound = true;
                break;
            }
        }
    }

    if (bodyFound) {
        startMeeting(io, lobbyId, reporterColor);
    }
}

function startMeeting(io, lobbyId, reporterColor) {
    const game = activeGames.get(lobbyId);
    if (!game) return;

    game.phase = 'meeting';
    game.votes = {}; // Resetta i voti

    // Riporta tutti vivi al centro
    for (let color in game.playersState) {
        const p = game.playersState[color];
        if (!p.isDead) {
            p.room = 'Centro';
            p.x = CANVAS_WIDTH / 2 + (Math.random() * 100 - 50); // Spargili un po'
            p.y = CANVAS_HEIGHT / 2 + (Math.random() * 100 - 50);
        }
    }

    // Invia i dati al client per costruire l'UI
    const playersList = Object.values(game.playersState).map(p => ({
        color: p.color,
        isDead: p.isDead
    }));

    io.to(lobbyId).emit('meetingStarted', {
        reporter: reporterColor,
        players: playersList,
        duration: 90 // 30 secondi per votare
    });

    // Avvia il timer del server
    if (meetingTimers[lobbyId]) clearTimeout(meetingTimers[lobbyId]);
    meetingTimers[lobbyId] = setTimeout(() => {
        endMeeting(io, lobbyId);
    }, 90000);
}

function processVote(io, lobbyId, voterColor, targetColor) {
    const game = activeGames.get(lobbyId);
    if (!game || game.phase !== 'meeting') return;

    const voter = game.playersState[voterColor];
    if (!voter || voter.isDead || game.votes[voterColor]) return; // Già votato o morto

    // targetColor può essere il colore di un giocatore o "skip"
    game.votes[voterColor] = targetColor;

    io.to(lobbyId).emit('playerVoted', voterColor);

    // Controlla se tutti i vivi hanno votato
    const alivePlayersCount = Object.values(game.playersState).filter(p => !p.isDead).length;
    const votesCount = Object.keys(game.votes).length;

    if (votesCount >= alivePlayersCount) {
        if (meetingTimers[lobbyId]) clearTimeout(meetingTimers[lobbyId]);
        endMeeting(io, lobbyId);
    }
}

function endMeeting(io, lobbyId) {
    const game = activeGames.get(lobbyId);
    if (!game || game.phase !== 'meeting') return;

    // Calcolo dei voti
    const tally = {};
    let maxVotes = 0;
    let ejectedPlayer = null;
    let isTie = false;

    Object.values(game.votes).forEach(vote => {
        tally[vote] = (tally[vote] || 0) + 1;
    });

    for (let target in tally) {
        if (tally[target] > maxVotes) {
            maxVotes = tally[target];
            ejectedPlayer = target;
            isTie = false;
        } else if (tally[target] === maxVotes) {
            isTie = true;
        }
    }

    let ejectionMessage = "Nessuno è stato espulso (Pareggio o Skip).";
    let isImpostorEjected = false;

    // Se c'è un espulso valido (non skip, non pareggio)
    if (ejectedPlayer && ejectedPlayer !== 'skip' && !isTie) {
        const p = game.playersState[ejectedPlayer];
        if (p) {
            p.isDead = true;
            isImpostorEjected = p.isImpostor;
            ejectionMessage = `${ejectedPlayer} è stato espulso.`;

            // Rimuoviamo le task del giocatore morto dal totale
            const unfinishedTasks = p.tasks.filter(t => !t.completed).length;
            game.totalTasks -= unfinishedTasks;
        }
    }

    // Manda l'evento al client per mostrare l'animazione/testo
    io.to(lobbyId).emit('meetingEnded', {
        message: ejectionMessage,
        ejectedColor: ejectedPlayer !== 'skip' && !isTie ? ejectedPlayer : null,
        wasImpostor: isImpostorEjected // Info opzionale, in Among Us a volte è nascosta
    });

    // Pulisci i cadaveri rimasti a terra (opzionale, ma consigliato per evitare report doppi)
    for (let color in game.playersState) {
        if (game.playersState[color].isDead) {
            game.playersState[color].x = -1000; // Nascondili fuori mappa
        }
    }

    // Congela il gioco per 5 secondi prima di riprendere
    game.phase = 'ejection_animation';

    setTimeout(() => {
        // Dopo 5 secondi, controlla se qualcuno ha vinto a causa dell'espulsione
        // altrimenti rimetti in exploration
        checkWinCondition(io, lobbyId);

        // Se checkWinCondition ha cambiato la fase in gameOver, non fare nulla.
        // Altrimenti, si torna a giocare.
        const updatedGame = activeGames.get(lobbyId);
        if (updatedGame && updatedGame.phase === 'ejection_animation') {
            updatedGame.phase = 'exploration';
            io.to(lobbyId).emit('resumeExploration');
        }
    }, 5000);
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

    // FIX: Permettiamo il controllo anche durante la fase di espulsione, 
    // altrimenti la funzione si blocca prima di contare i giocatori!
    if (!game || (game.phase !== 'exploration' && game.phase !== 'ejection_animation')) return;

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

    // Vittoria Impostori (Se gli impostori vivi sono pari o superiori ai crewmate)
    if (aliveImpostors >= aliveCrewmates && aliveImpostors > 0) {
        game.phase = 'gameOver';
        if (game.loopInterval) clearInterval(game.loopInterval);
        io.to(lobbyId).emit('gameOver', { winner: 'impostors', hostColor });
    }
    // Vittoria Crewmates (Se non ci sono più impostori OR Tutte le task finite)
    else if (aliveImpostors === 0 || (game.totalTasks > 0 && game.completedTasks >= game.totalTasks)) {
        game.phase = 'gameOver';
        if (game.loopInterval) clearInterval(game.loopInterval);
        io.to(lobbyId).emit('gameOver', { winner: 'crewmates', hostColor });
    }
}

module.exports = { initializeGame, processMovement, processKill, processTask, processReport, processVote };