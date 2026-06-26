// backend/sockets/games/fpsGameSocket.js
const { lobbies } = require('../../store/lobbies');
const { activeGames } = require('../../store/activeGames');

const GAME_ID = 'fps';

// Configurazione armi
const WEAPONS = {
    assault: { name: 'Assault Rifle', damage: 25, fireRate: 150, range: 80, ammo: 30, reload: 2000, spread: 0.03, auto: true },
    smg: { name: 'SMG', damage: 18, fireRate: 80, range: 40, ammo: 45, reload: 1500, spread: 0.06, auto: true },
    shotgun: { name: 'Shotgun', damage: 80, fireRate: 900, range: 20, ammo: 8, reload: 2500, spread: 0.15, auto: false },
    sniper: { name: 'Sniper Rifle', damage: 95, fireRate: 1500, range: 150, ammo: 5, reload: 3000, spread: 0.005, auto: false }
};

// Spawn points per la mappa
const SPAWN_POINTS = [
    { x: -45, y: 0, z: -45, angle: Math.PI * 0.25 },
    { x: 45, y: 0, z: 45, angle: Math.PI * 1.25 },
    { x: -45, y: 0, z: 45, angle: Math.PI * -0.25 },
    { x: 45, y: 0, z: -45, angle: Math.PI * 0.75 },
    { x: 0, y: 0, z: -55, angle: Math.PI },
    { x: 0, y: 0, z: 55, angle: 0 },
    { x: -55, y: 0, z: 0, angle: Math.PI * 0.5 },
    { x: 55, y: 0, z: 0, angle: Math.PI * -0.5 }
];

const PLAYER_HP = 100;
const WEAPON_SELECT_TIME = 20000; // 20 secondi per scegliere l'arma
const ROUND_END_DELAY = 5000;

module.exports = function (io, socket) {

    // ──────────────────────────────────────────
    // AVVIO DAL LOBBY
    // ──────────────────────────────────────────
    socket.on('startGame', (data) => {
        const { lobbyId, gameId, settings } = data;
        if (gameId !== GAME_ID) return;

        const lobby = lobbies.get(lobbyId);
        if (!lobby) return;

        lobby.gameSettings = settings;
        io.to(lobbyId).emit('gameSelected', { gameId, settings });
    });

    // ──────────────────────────────────────────
    // JOIN GAME
    // ──────────────────────────────────────────
    socket.on('joinFPS', (data) => {
        const { lobbyId, playerColor } = data;
        socket.join(lobbyId);
        socket.data.lobbyId = lobbyId;
        socket.data.color = playerColor;

        const lobby = lobbies.get(lobbyId);
        if (!lobby) return;

        // Inizializza partita se non esiste
        if (!activeGames.has(lobbyId)) {
            const settings = lobby.gameSettings || {};
            const totalRounds = parseInt(settings.rounds) || 5;

            const game = {
                gameId: GAME_ID,
                phase: 'weapon_select', // weapon_select | playing | round_end | game_over
                totalRounds,
                currentRound: 1,
                scores: {},              // color -> wins
                players: {},              // color -> playerState
                weaponChoices: {},              // color -> weaponKey
                confirmedCount: 0,
                selectTimer: null,
                aliveCount: 0
            };

            lobby.players.forEach(c => {
                game.scores[c] = 0;
                game.weaponChoices[c] = 'assault';
            });

            activeGames.set(lobbyId, game);
            startWeaponSelect(io, lobbyId);
        }

        const game = activeGames.get(lobbyId);

        // Invia stato attuale al giocatore appena connesso
        socket.emit('fpsInit', {
            phase: game.phase,
            currentRound: game.currentRound,
            totalRounds: game.totalRounds,
            scores: game.scores,
            players: game.players,
            weapons: WEAPONS,
            myColor: playerColor,
            hostColor: lobby.host
        });

        // WebRTC signaling: notifica agli altri peer
        socket.to(lobbyId).emit('peerJoined', { color: playerColor, socketId: socket.id });

        // Invia lista peer esistenti al nuovo arrivato
        const peers = [];
        for (const [sid, s] of io.sockets.sockets) {
            if (s.data.lobbyId === lobbyId && sid !== socket.id) {
                peers.push({ color: s.data.color, socketId: sid });
            }
        }
        socket.emit('existingPeers', peers);
    });

    // ──────────────────────────────────────────
    // WebRTC SIGNALING (passthrough)
    // ──────────────────────────────────────────
    socket.on('rtcOffer', ({ targetSocketId, sdp }) => {
        io.to(targetSocketId).emit('rtcOffer', { fromSocketId: socket.id, sdp });
    });

    socket.on('rtcAnswer', ({ targetSocketId, sdp }) => {
        io.to(targetSocketId).emit('rtcAnswer', { fromSocketId: socket.id, sdp });
    });

    socket.on('rtcIceCandidate', ({ targetSocketId, candidate }) => {
        io.to(targetSocketId).emit('rtcIceCandidate', { fromSocketId: socket.id, candidate });
    });

    // ──────────────────────────────────────────
    // SELEZIONE ARMA
    // ──────────────────────────────────────────
    socket.on('chooseWeapon', ({ lobbyId, playerColor, weaponKey }) => {
        const game = activeGames.get(lobbyId);
        if (!game || game.phase !== 'weapon_select') return;
        if (!WEAPONS[weaponKey]) return;

        game.weaponChoices[playerColor] = weaponKey;
        io.to(lobbyId).emit('weaponChosen', { playerColor, weaponKey });
    });

    socket.on('confirmWeapon', ({ lobbyId, playerColor }) => {
        const game = activeGames.get(lobbyId);
        if (!game || game.phase !== 'weapon_select') return;

        const lobby = lobbies.get(lobbyId);
        if (!lobby) return;

        if (!game._confirmed) game._confirmed = new Set();
        if (game._confirmed.has(playerColor)) return;
        game._confirmed.add(playerColor);

        io.to(lobbyId).emit('playerConfirmed', { playerColor, count: game._confirmed.size, total: lobby.players.length });

        if (game._confirmed.size >= lobby.players.length) {
            clearTimeout(game.selectTimer);
            launchRound(io, lobbyId);
        }
    });

    // ──────────────────────────────────────────
    // STATO GIOCATORE (autoritativo lato client,
    // broadcast agli altri tramite WebRTC data channel.
    // Il server riceve solo eventi critici)
    // ──────────────────────────────────────────
    socket.on('playerState', (data) => {
        // Relay dello stato posizione/rotazione via socket come fallback
        // (i client useranno preferibilmente il data channel WebRTC)
        const { lobbyId } = data;
        socket.to(lobbyId).emit('playerState', data);
    });

    // ──────────────────────────────────────────
    // HIT DETECTION (server autoritativo)
    // ──────────────────────────────────────────
    socket.on('reportHit', (data) => {
        const { lobbyId, shooterColor, targetColor, weaponKey } = data;
        const game = activeGames.get(lobbyId);
        if (!game || game.phase !== 'playing') return;

        const target = game.players[targetColor];
        if (!target || target.dead) return;

        const weapon = WEAPONS[weaponKey];
        if (!weapon) return;

        target.hp -= weapon.damage;

        io.to(lobbyId).emit('playerHit', {
            targetColor,
            hp: Math.max(0, target.hp),
            shooterColor,
            damage: weapon.damage
        });

        if (target.hp <= 0) {
            target.dead = true;
            game.aliveCount--;

            io.to(lobbyId).emit('playerKilled', {
                killedColor: targetColor,
                killerColor: shooterColor,
                aliveCount: game.aliveCount
            });

            checkRoundEnd(io, lobbyId);
        }
    });

    // ──────────────────────────────────────────
    // CHAT IN-GAME
    // ──────────────────────────────────────────
    socket.on('fpsChat', ({ lobbyId, playerColor, message }) => {
        io.to(lobbyId).emit('fpsChat', { playerColor, message, ts: Date.now() });
    });

    // ──────────────────────────────────────────
    // RETURN TO LOBBY (host)
    // ──────────────────────────────────────────
    socket.on('fpsReturnToLobby', (lobbyId) => {
        const lobby = lobbies.get(lobbyId);
        if (!lobby || lobby.host !== socket.data.color) return;
        activeGames.delete(lobbyId);
        io.to(lobbyId).emit('redirectAllToLobby');
    });
};

// ──────────────────────────────────────────
// HELPERS SERVER-SIDE
// ──────────────────────────────────────────

function startWeaponSelect(io, lobbyId) {
    const game = activeGames.get(lobbyId);
    const lobby = lobbies.get(lobbyId);
    if (!game || !lobby) return;

    game.phase = 'weapon_select';
    game._confirmed = new Set();

    io.to(lobbyId).emit('phaseWeaponSelect', {
        duration: WEAPON_SELECT_TIME,
        currentRound: game.currentRound,
        totalRounds: game.totalRounds,
        scores: game.scores,
        weapons: WEAPONS
    });

    game.selectTimer = setTimeout(() => {
        launchRound(io, lobbyId);
    }, WEAPON_SELECT_TIME);
}

function launchRound(io, lobbyId) {
    const game = activeGames.get(lobbyId);
    const lobby = lobbies.get(lobbyId);
    if (!game || !lobby) return;

    game.phase = 'playing';

    // Assegna spawn points in modo casuale
    const shuffledSpawns = [...SPAWN_POINTS].sort(() => Math.random() - 0.5);

    game.players = {};
    game.aliveCount = 0;

    lobby.players.forEach((color, i) => {
        const spawn = shuffledSpawns[i % shuffledSpawns.length];
        const weapon = WEAPONS[game.weaponChoices[color] || 'assault'];

        game.players[color] = {
            color,
            hp: PLAYER_HP,
            dead: false,
            x: spawn.x,
            y: spawn.y,
            z: spawn.z,
            angle: spawn.angle,
            weaponKey: game.weaponChoices[color] || 'assault',
            ammo: weapon.ammo,
            maxAmmo: weapon.ammo
        };
        game.aliveCount++;
    });

    io.to(lobbyId).emit('roundStart', {
        round: game.currentRound,
        totalRounds: game.totalRounds,
        players: game.players,
        weapons: WEAPONS
    });
}

function checkRoundEnd(io, lobbyId) {
    const game = activeGames.get(lobbyId);
    const lobby = lobbies.get(lobbyId);
    if (!game || !lobby) return;

    const alive = Object.values(game.players).filter(p => !p.dead);
    if (alive.length > 1) return;

    game.phase = 'round_end';
    const winner = alive.length === 1 ? alive[0].color : null;

    if (winner) {
        game.scores[winner] = (game.scores[winner] || 0) + 1;
    }

    io.to(lobbyId).emit('roundEnd', {
        winnerColor: winner,
        scores: game.scores,
        round: game.currentRound,
        totalRounds: game.totalRounds
    });

    game.currentRound++;

    if (game.currentRound > game.totalRounds) {
        // Partita finita
        setTimeout(() => endGame(io, lobbyId), ROUND_END_DELAY);
    } else {
        // Prossimo round
        setTimeout(() => startWeaponSelect(io, lobbyId), ROUND_END_DELAY);
    }
}

function endGame(io, lobbyId) {
    const game = activeGames.get(lobbyId);
    const lobby = lobbies.get(lobbyId);
    if (!game || !lobby) return;

    game.phase = 'game_over';

    // Trova il vincitore assoluto
    let topScore = -1;
    let champion = null;
    for (const [color, wins] of Object.entries(game.scores)) {
        if (wins > topScore) { topScore = wins; champion = color; }
    }

    io.to(lobbyId).emit('gameOver', {
        champion,
        scores: game.scores,
        hostColor: lobby.host
    });
}