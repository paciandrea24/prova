const lobbies = new Map();
const users = new Map();

function generateLobbyId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

module.exports = { lobbies, users, generateLobbyId };
