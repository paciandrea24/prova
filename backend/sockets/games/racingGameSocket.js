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
            if (lobby) lobby.gameSettings = settings;

            io.to(lobbyId).emit('gameSelected', { gameId, settings });
        }
    });

    socket.on('joinRacing', (data) => {
        const { lobbyId, playerColor } = data;
        const lobby = lobbies.get(lobbyId);

        if (!lobby) return;

        if (!activeGames.has(lobbyId)) {
            initializeRacingGame(lobbyId, lobby.players, lobby.gameSettings || {});
        }

        const game = activeGames.get(lobbyId);

        // [FIX EXPLOIT]: Inizializziamo dei flag di sicurezza per tracciare se la gara è già partita
        if (game.countdownTriggered === undefined) {
            game.countdownTriggered = false;
            game.raceStarted = false;
        }

        const currentTrack = game.tracks[game.currentTrackIndex];

        socket.emit('racingSetup', {
            playersState: game.playersState,
            trackMap: currentTrack.map,
            tileSize: game.tileSize,
            trackName: currentTrack.name,
            hostColor: lobby.host,
            isSingleMode: game.isSingleMode,
            totalLaps: game.totalLaps || 1
        });

        // [FIX EXPLOIT CRITICO]: Avviamo il countdown SOLO la primissima volta che l'host entra.
        // Se la gara è già stata avviata (es. il giocatore ha premuto F5), NON azzeriamo i tempi!
        if (playerColor === lobby.host && !game.countdownTriggered) {
            game.countdownTriggered = true; // Blocca i futuri avvii abusivi
            io.to(lobbyId).emit('message', { message: 'La gara inizierà tra 3 secondi...', type: 'system' });

            setTimeout(() => {
                game.raceStarted = true;
                startRace(io, lobbyId); // [FIX]: Rimosso serverStartTime, ci pensa startRace!
            }, 3000);
        } else if (game.raceStarted && game.startTime) {
            // [FIX]: Utilizziamo game.startTime che viene aggiornato ad ogni nuova mappa!
            const elapsed = Date.now() - game.startTime;

            // Inviamo il segnale di GO! passando anche il tempo da recuperare
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
};