document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const lobbyId = urlParams.get('lobby');
    const selectedColor = urlParams.get('color');
    const gameId = urlParams.get('game');

    if (!lobbyId || !selectedColor || !gameId) {
        window.location.href = '/';
        return;
    }

    // Carica il gioco specifico
    loadGame(gameId, lobbyId, selectedColor);
});

function loadGame(gameId, lobbyId, playerColor) {
    let gameContainer = document.getElementById('game-container');

    switch (gameId) {
        case 'quiz':
            loadQuizGame(gameContainer, lobbyId, playerColor);
            break;
        case 'memory':
            loadMemoryGame(gameContainer, lobbyId, playerColor);
            break;
        // Altri casi per altri giochi
        default:
            gameContainer.innerHTML = '<p>Gioco non trovato!</p>';
            setTimeout(() => {
                window.location.href = `/lobby.html?lobby=${lobbyId}&color=${playerColor}`;
            }, 3000);
    }
}

// Funzioni specifiche per caricare ciascun gioco
function loadQuizGame(container, lobbyId, playerColor) {
    // Logica per caricare il gioco Quiz
}

function loadMemoryGame(container, lobbyId, playerColor) {
    // Logica per caricare il gioco Memory
}