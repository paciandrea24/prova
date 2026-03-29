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

function initializeGame(io, lobbyId, players, settings) {
    const numImpostors = parseInt(settings.impostors) || 1;

    let game = activeGames.get(lobbyId);

    // PREVENZIONE BUG LAMPEGGIO SERVER: Elimina i loop vecchi se riavvi il gioco
    if (game && game.loopInterval) {
        clearInterval(game.loopInterval);
    }

    // Scegli impostori a caso
    const shuffled = [...players].sort(() => 0.5 - Math.random());
    const impostors = shuffled.slice(0, numImpostors);

    const playersState = {};
    players.forEach(color => {
        playersState[color] = {
            color: color,
            room: 'Centro', // Spawn iniziale
            x: CANVAS_WIDTH / 2,
            y: CANVAS_HEIGHT / 2,
            facing: 'down',
            isImpostor: impostors.includes(color),
            isDead: false
        };
    });

    game = {
        gameId: 'deduction',
        type: 'deduction',
        phase: 'starting',
        playersState: playersState,
        loopInterval: null
    };

    activeGames.set(lobbyId, game);

    // TEMPORIZZATORE: Dopo 6 secondi toglie l'overlay a tutti e permette di muoversi
    setTimeout(() => {
        const activeGame = activeGames.get(lobbyId);
        // Controlla che il gioco esista ancora e sia effettivamente bloccato in "starting"
        if (activeGame && activeGame.phase === 'starting') {
            activeGame.phase = 'exploration';
            io.to(lobbyId).emit('explorationStarted');
            console.log(`🔪 Partita Deduction iniziata nella lobby ${lobbyId}`);
        }
    }, 6000); // 6 secondi compensano il tempo di caricamento della pagina web

    // Mettiamo il tick del server a 30 FPS. Il movimento sembrerà a 60 FPS
    // perché i client fanno previsione locale per se stessi.
    game.loopInterval = setInterval(() => {
        if (game.phase !== 'exploration') return;

        const rooms = Object.keys(ROOM_CONFIG);
        rooms.forEach(roomName => {
            const playersInRoom = {};
            for (let color in game.playersState) {
                if (game.playersState[color].room === roomName) {
                    playersInRoom[color] = game.playersState[color];
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

    // Controllo Transizioni (Porte)
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
        // Logica Socket.io Sub-Rooms
        socket.leave(`${lobbyId}_${player.room}`);
        player.room = newRoom;
        socket.join(`${lobbyId}_${player.room}`);

        socket.emit('roomTransition', { newRoom, x: player.x, y: player.y });
    }
}

function processKill(io, lobbyId, playerColor) {
    const game = activeGames.get(lobbyId);
    if (!game || game.phase !== 'exploration') return;

    const killer = game.playersState[playerColor];
    if (!killer || !killer.isImpostor || killer.isDead) return;

    // Cerca vittima nella STESSA STANZA
    for (let targetColor in game.playersState) {
        if (targetColor === playerColor) continue;
        const victim = game.playersState[targetColor];

        if (victim.room === killer.room && !victim.isDead && !victim.isImpostor) {
            // Teorema di Pitagora
            const dx = victim.x - killer.x;
            const dy = victim.y - killer.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < 100) { // Range
                // Validazione sguardo (Semplificata)
                let valid = false;
                if (killer.facing === 'right' && victim.x > killer.x) valid = true;
                if (killer.facing === 'left' && victim.x < killer.x) valid = true;
                if (killer.facing === 'up' && victim.y < killer.y) valid = true;
                if (killer.facing === 'down' && victim.y > killer.y) valid = true;

                if (valid) {
                    victim.isDead = true;
                    io.to(`${lobbyId}_${killer.room}`).emit('playerKilled', targetColor);

                    // CONTROLLA SE LA PARTITA DEVE FINIRE DOPO QUESTA UCCISIONE
                    checkWinCondition(io, lobbyId);

                    break;
                }
            }
        }
    }
}

// AGGIUNGI QUESTA FUNZIONE
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

    // Recupera l'Host della lobby
    const lobby = lobbies.get(lobbyId);
    const hostColor = lobby ? lobby.host : null;

    if (aliveImpostors >= aliveCrewmates) {
        game.phase = 'gameOver';
        clearInterval(game.loopInterval);
        // Aggiungi hostColor qui
        io.to(lobbyId).emit('gameOver', { winner: 'impostors', hostColor });
    } else if (aliveImpostors === 0) {
        game.phase = 'gameOver';
        clearInterval(game.loopInterval);
        // Aggiungi hostColor qui
        io.to(lobbyId).emit('gameOver', { winner: 'crewmates', hostColor });
    }
}

module.exports = { initializeGame, processMovement, processKill };