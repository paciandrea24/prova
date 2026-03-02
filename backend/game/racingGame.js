const { activeGames } = require('../store/activeGames');

function initializeRacingGame(lobbyId, players, settings) {
    console.log(`🏎️ Inizializzazione Racing 2D per lobby ${lobbyId}`);

    const playersState = {};

    // Posizioniamo le auto alla griglia di partenza (X = 50, Y spaziate)
    players.forEach((p, index) => {
        playersState[p] = {
            color: p,
            x: 50,
            y: 100 + (index * 80), // Spazia le auto verticalmente
            angle: 0,
            inputs: { w: false, a: false, s: false, d: false },
            finished: false,
            place: null
        };
    });

    const game = {
        lobbyId,
        gameId: 'racing',
        players: [...players],
        playersState,
        trackWidth: 1000,  // Larghezza dell'arena
        trackHeight: 600,  // Altezza dell'arena
        finishLineX: 900,  // X del traguardo
        podium: [],
        isActive: false,
        loopInterval: null
    };

    activeGames.set(lobbyId, game);
    return game;
}

// Funzione che applica i movimenti 30 volte al secondo
// Funzione che applica i movimenti 30 volte al secondo
function runGameLoop(io, lobbyId) {
    const game = activeGames.get(lobbyId);
    if (!game) return;

    const speed = 7; // Velocità di movimento
    const carSize = 40; // Ingombro per non far uscire l'auto dallo schermo

    game.loopInterval = setInterval(() => {
        if (!game.isActive) return;

        let everyoneFinished = true;

        for (const [color, pState] of Object.entries(game.playersState)) {
            if (pState.finished) continue;
            everyoneFinished = false;

            let dx = 0;
            let dy = 0;

            // Movimento W A S D
            if (pState.inputs.w) dy -= speed;
            if (pState.inputs.s) dy += speed;
            if (pState.inputs.a) dx -= speed;
            if (pState.inputs.d) dx += speed;

            // Aggiorna le coordinate
            pState.x += dx;
            pState.y += dy;

            // Se l'auto si sta muovendo, calcola l'angolo verso cui deve puntare il muso
            if (dx !== 0 || dy !== 0) {
                let targetAngle = Math.atan2(dy, dx) * (180 / Math.PI);

                // Matematica per far ruotare l'auto nel verso più rapido (evita brutti scatti di 360°)
                let diff = targetAngle - pState.angle;
                while (diff <= -180) diff += 360;
                while (diff > 180) diff -= 360;

                pState.angle += diff;
            }

            // Collisioni con i bordi dell'arena (Sopra / Sotto)
            if (pState.y < 0) pState.y = 0;
            if (pState.y > game.trackHeight - carSize) pState.y = game.trackHeight - carSize;

            // Collisione per non uscire dalla mappa all'indietro
            if (pState.x < 0) pState.x = 0;

            // Controllo Traguardo
            if (pState.x >= game.finishLineX) {
                pState.x = game.finishLineX; // Blocca l'auto sulla linea di fine
                pState.finished = true;
                game.podium.push(color);
                pState.place = game.podium.length;

                // Manda un messaggio in chat per l'arrivo
                io.to(lobbyId).emit('message', {
                    message: `Il giocatore ${color} ha tagliato il traguardo al ${pState.place}° posto!`,
                    type: 'success'
                });
            }
        }

        // Invia le nuove coordinate (x, y, angle) a tutti i client
        io.to(lobbyId).emit('racingStateUpdate', game.playersState);

        // Condizione di fine partita: se sono arrivati i primi 3 o se tutti hanno tagliato il traguardo
        if (game.podium.length === 3 || everyoneFinished) {
            endRace(io, lobbyId);
        }
    }, 1000 / 30); // Esegue il loop a ~30 FPS
}

function updatePlayerInput(lobbyId, playerColor, inputs) {
    const game = activeGames.get(lobbyId);
    if (game && game.playersState[playerColor] && game.isActive) {
        game.playersState[playerColor].inputs = inputs;
    }
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
    clearInterval(game.loopInterval); // Ferma il game loop server-side

    io.to(lobbyId).emit('raceEnded', { podium: game.podium });

    // Ritorno in lobby dopo 10 secondi
    setTimeout(() => {
        activeGames.delete(lobbyId);
        io.to(lobbyId).emit('returnToLobby');
    }, 10000);
}

module.exports = { initializeRacingGame, updatePlayerInput, startRace };