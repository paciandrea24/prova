const { activeGames } = require('../../store/activeGames');
const { lobbies } = require('../../store/lobbies');
const { initializeRacingGame, startRace, updatePlayerInput, restartRace } = require('../../game/racingGame');
const leaderboard = require('../../store/leaderboard');

module.exports = function (io, socket) {

    socket.on('startGame', (data) => {
        const { lobbyId, gameId, settings } = data;

        if (gameId === 'racing') {
            console.log(`🎮 StartGame ricevuto per Racing in lobby ${lobbyId}`);
            const lobby = lobbies.get(lobbyId);
            if (lobby) {
                lobby.gameSettings = settings;
                // [FIX CRITICO]: "Fotografiamo" i giocatori in lobby nel momento esatto 
                // in cui l'host clicca Start. Questo previene che chi carica la pagina 
                // in ritardo venga escluso dalla griglia di partenza della 1° gara!
                lobby.lockedPlayers = [...lobby.players];
            }

            io.to(lobbyId).emit('gameSelected', { gameId, settings });
        }
    });

    socket.on('joinRacing', (data) => {
        const { lobbyId, playerColor } = data;
        const lobby = lobbies.get(lobbyId);

        if (!lobby) return;

        if (!activeGames.has(lobbyId)) {
            // [FIX]: Usiamo la "fotografia" dei giocatori per la griglia iniziale se disponibile
            const playersList = (lobby.lockedPlayers && lobby.lockedPlayers.length > 0) ? lobby.lockedPlayers : lobby.players;
            initializeRacingGame(lobbyId, playersList, lobby.gameSettings || {});
        }

        const game = activeGames.get(lobbyId);
        let newPlayerAdded = false;

        // [FIX]: Se un giocatore entra molto dopo o fa F5, lo integriamo al volo
        if (!game.players.includes(playerColor)) {
            game.players.push(playerColor);
            game.cumulativeTimes[playerColor] = 0;

            const track = game.tracks[game.currentTrackIndex];
            game.playersState[playerColor] = {
                color: playerColor,
                x: track.spawnX,
                y: track.spawnY,
                angle: track.angle,
                inputs: { w: false, a: false, s: false, d: false },
                progress: 0,
                finished: false,
                place: null,
                time: null,
                lastActiveTime: Date.now(),
                dnf: false
            };
            newPlayerAdded = true;
        }

        // Flag di sicurezza
        if (game.countdownTriggered === undefined) {
            game.countdownTriggered = false;
            game.raceStarted = false;
        }

        const currentTrack = game.tracks[game.currentTrackIndex];
        const setupData = {
            playersState: game.playersState,
            trackMap: currentTrack.map,
            tileSize: game.tileSize,
            trackName: currentTrack.name,
            hostColor: lobby.host,
            isSingleMode: game.isSingleMode,
            totalLaps: game.totalLaps || 1
        };

        // Se abbiamo aggiunto un giocatore dopo che la lobby è stata creata (e la gara non è partita),
        // aggiorniamo la griglia a TUTTI i giocatori già dentro per fargli disegnare la nuova auto.
        if (newPlayerAdded && !game.raceStarted) {
            io.to(lobbyId).emit('racingSetup', setupData);
        } else {
            socket.emit('racingSetup', setupData);
        }

        // [FIX EXPLOIT CRITICO]: Avviamo il countdown SOLO la primissima volta che l'host entra.
        if (playerColor === lobby.host && !game.countdownTriggered) {
            game.countdownTriggered = true;
            io.to(lobbyId).emit('message', { message: 'La gara inizierà tra 3 secondi...', type: 'system' });

            setTimeout(() => {
                game.raceStarted = true;
                startRace(io, lobbyId);
            }, 3000);
        } else if (game.raceStarted && game.startTime) {
            const elapsed = Date.now() - game.startTime;
            socket.emit('raceStarted', { syncTime: elapsed });
        }
    });

    socket.on('saveNewRecord', (data) => {
        const { lobbyId, trackName, playerName, playerColor, time } = data;
        leaderboard.addRecord(trackName, playerName, playerColor, time);
        io.to(lobbyId).emit('message', {
            message: `🌟 La leggenda [${playerName}] ha scritto il suo nome nella storia di ${trackName}!`,
            type: 'success'
        });
    });

    socket.on('racingInput', (data) => {
        const { lobbyId, playerColor, inputs } = data;
        updatePlayerInput(lobbyId, playerColor, inputs);
    });

    socket.on('restartRace', (lobbyId) => {
        restartRace(io, lobbyId);
    });


    socket.on('forceReturnToLobby', (lobbyId) => {
        activeGames.delete(lobbyId);
        // [FIX]: Aggiornato anche qui con il nome corretto dell'evento
        io.to(lobbyId).emit('redirectAllToLobby');
    });
};