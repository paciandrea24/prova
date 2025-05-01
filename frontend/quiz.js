document.addEventListener('DOMContentLoaded', () => {
    // Parse URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const lobbyId = urlParams.get('lobby');
    const playerColor = urlParams.get('color');
    const gameId = urlParams.get('game');

    if (!lobbyId || !playerColor) {
        window.location.href = '/';
        return;
    }

    // Game state
    const gameState = {
        players: [],
        playerRoles: {},
        myRole: null,
        isHost: false,
        currentRound: 0,
        totalRounds: 5,
        currentPhase: 'waiting',
        eliminatedPlayers: [],
        drawings: {},
        votes: {},
        myVote: null,
        scenario: null,
        discussionTime: 120, // 2 minutes discussion
        drawingTime: 60, // 1 minute to draw
        viewingTime: 5, // 5 seconds to view image
    };

    // Canvas variables
    let canvas, ctx;
    let isDrawing = false;
    let lastX = 0;
    let lastY = 0;
    let currentColor = '#000000';
    let currentLineWidth = 5;
    let currentTool = 'pen'; // 'pen' or 'eraser'

    // Setup WebSocket
    const socket = io();

    // Join lobby
    socket.emit('joinLobby', lobbyId);

    // Request lobby data
    fetchLobbyData();

    // Request game data when joining
    socket.emit('joinQuizGame', { lobbyId, playerColor });

    // Listen for game events
    setupSocketListeners();

    // Setup UI event listeners
    setupEventListeners();

    // Initialize drawing canvas
    initializeCanvas();

    // Update the game UI based on current phase
    function updateUI() {
        // Hide all phases
        document.querySelectorAll('.game-phase').forEach(phase => {
            phase.classList.remove('active');
        });

        // Show current phase
        document.getElementById(gameState.currentPhase).classList.add('active');

        // Update round info
        document.getElementById('current-round').textContent = gameState.currentRound;
        document.getElementById('total-rounds').textContent = gameState.totalRounds;

        // Update players status
        updatePlayersStatus();

        // Add specific phase logic here
        switch (gameState.currentPhase) {
            case 'waiting':
                updateWaitingPhase();
                break;
            case 'role-reveal':
                updateRoleRevealPhase();
                break;
            case 'image-display':
                updateImageDisplayPhase();
                break;
            case 'drawing-phase':
                updateDrawingPhase();
                break;
            case 'gallery-phase':
                updateGalleryPhase();
                break;
            case 'voting-phase':
                updateVotingPhase();
                break;
            case 'results-phase':
                updateResultsPhase();
                break;
            case 'game-end':
                updateGameEndPhase();
                break;
        }
    }

    // Update waiting phase UI
    function updateWaitingPhase() {
        const playersList = document.getElementById('players-list');
        playersList.innerHTML = '';

        // Add current player
        const myPlayerItem = document.createElement('li');
        myPlayerItem.innerHTML = `
            <div class="player-entry-1">
                <div class="avatar-circle">
                    <div class="avatar-color" style="background-color: ${playerColor};"></div>
                </div>
                <p class="player-entry-text">You</p>
                ${gameState.isHost ? '<span class="host-indicator">(Host)</span>' : ''}
            </div>
        `;
        playersList.appendChild(myPlayerItem);

        // Add other players
        gameState.players.forEach((player, index) => {
            if (player !== playerColor) {
                const playerItem = document.createElement('li');
                const entryClass = index % 2 === 0 ? 'player-entry-1' : 'player-entry-2';
                playerItem.innerHTML = `
                    <div class="${entryClass}">
                        <div class="avatar-circle">
                            <div class="avatar-color" style="background-color: ${player};"></div>
                        </div>
                        <p class="player-entry-text">${player}</p>
                        ${gameState.isHost ? '' : ''}
                    </div>
                `;
                playersList.appendChild(playerItem);
            }
        });

        // Show/hide host controls
        const hostControls = document.getElementById('host-controls');
        if (gameState.isHost) {
            hostControls.classList.remove('hidden');

            // Enable/disable start button based on player count
            const startButton = document.getElementById('start-game-btn');
            startButton.disabled = gameState.players.length < 3;

            if (gameState.players.length < 3) {
                startButton.title = "Need at least 3 players to start";
            } else {
                startButton.title = "Start the game";
            }
        } else {
            hostControls.classList.add('hidden');
        }
    }

    // Update role reveal phase UI
    function updateRoleRevealPhase() {
        const roleName = document.getElementById('role-name');
        const roleDescription = document.getElementById('role-description');

        roleName.textContent = gameState.myRole;
        roleName.className = gameState.myRole.toLowerCase();

        if (gameState.myRole === 'Investigator') {
            roleDescription.textContent = 'Your goal is to identify the Killers. Look carefully at the images and draw important evidence to help solve the case.';
        } else {
            roleDescription.textContent = 'Your goal is to mislead the investigation. You will see a different image than the Investigators. Try to blend in by drawing plausible but misleading evidence.';
        }
    }

    // Update image display phase UI
    function updateImageDisplayPhase() {
        const countdown = document.getElementById('countdown');
        const scenarioImage = document.getElementById('scenario-image');

        // Set the image source based on role
        if (gameState.scenario) {
            const imageUrl = gameState.myRole === 'Investigator'
                ? gameState.scenario.investigatorImage
                : gameState.scenario.killerImage;

            scenarioImage.src = imageUrl;
        }

        // Start countdown
        let seconds = gameState.viewingTime;
        countdown.textContent = seconds;

        const timer = setInterval(() => {
            seconds--;
            countdown.textContent = seconds;

            if (seconds <= 0) {
                clearInterval(timer);
                // This will be handled by the server event
            }
        }, 1000);
    }

    // Update drawing phase UI
    function updateDrawingPhase() {
        const instructions = document.getElementById('drawing-instructions');

        if (gameState.myRole === 'Investigator') {
            instructions.textContent = 'Draw an important piece of evidence you saw in the image';
        } else {
            instructions.textContent = 'Draw something that seems like it could be evidence from the scene';
        }

        // Reset canvas
        clearCanvas();

        // Start timer
        let seconds = gameState.drawingTime;
        document.getElementById('drawing-timer').textContent = seconds;

        const timer = setInterval(() => {
            seconds--;
            document.getElementById('drawing-timer').textContent = seconds;

            if (seconds <= 0) {
                clearInterval(timer);
                // This will be handled by server event or submit button
            }
        }, 1000);
    }

    // Update gallery phase UI
}
