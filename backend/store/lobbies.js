const lobbies = new Map();
const users = new Map();
const destroyTimers = new Map(); // timer di distruzione lobby condivisi tra socketManager e game sockets

function generateLobbyId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

module.exports = { lobbies, users, generateLobbyId, destroyTimers };
