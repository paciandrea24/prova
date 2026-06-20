// frontend/spleef.js
const socket = io();
const urlParams = new URLSearchParams(window.location.search);
const lobbyId = urlParams.get('lobby') || 'default-lobby';
const myColor = urlParams.get('color'); // Ci servirà per tornare in lobby

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a252f);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.4);
dirLight.position.set(10, 50, 10);
scene.add(dirLight);

const blockSize = 3;
const blocksMap = {};
let serverMap = [];
const otherPlayers = {};
let myId = null;

const myPlayer = new THREE.Object3D();
myPlayer.add(camera);
camera.position.set(0, 2.5, 0);
scene.add(myPlayer);

// --- FUNZIONE DI COSTRUZIONE MAPPA ---
// La usiamo sia allo Start che al Restart
function buildArena(mapData, playersData) {
    // 1. Pulisce la vecchia scena
    for (let key in blocksMap) { scene.remove(blocksMap[key]); delete blocksMap[key]; }
    for (let key in otherPlayers) { scene.remove(otherPlayers[key]); delete otherPlayers[key]; }

    serverMap = mapData;
    isDead = false;
    velocityY = 0;

    // 2. Riposiziona noi stessi
    const myData = playersData[myId];
    myPlayer.position.set(myData.x, myData.y, myData.z);
    myPlayer.rotation.set(0, 0, 0);
    yaw = 0; pitch = 0;

    // 3. Ricostruisce la neve
    const blockGeo = new THREE.BoxGeometry(blockSize, blockSize, blockSize);
    const blockMat = new THREE.MeshStandardMaterial({ color: 0xECF0F1, roughness: 0.9 });
    for (let r = 0; r < serverMap.length; r++) {
        for (let c = 0; c < serverMap[r].length; c++) {
            if (serverMap[r][c] === 1) {
                const block = new THREE.Mesh(blockGeo, blockMat);
                block.position.set(c * blockSize, -blockSize / 2, r * blockSize);
                block.userData = { row: r, col: c };
                scene.add(block);
                blocksMap[`${r}-${c}`] = block;
            }
        }
    }

    // 4. Ricostruisce i nemici vivi
    Object.keys(playersData).forEach((id) => {
        if (id !== myId && playersData[id].isAlive) {
            renderNewEnemy(playersData[id]);
        }
    });
}

// Diciamo al server di annullare l'autodistruzione della lobby e di ricordarsi chi siamo
socket.emit('joinLobby', { lobbyId: lobbyId, color: myColor });

// Poi entriamo fisicamente nell'arena 3D
socket.emit('joinSpleefGame', lobbyId);

socket.on('spleefSetup', (data) => {
    myId = data.myId;

    // Mostra/Nasconde i controlli Host
    if (data.isHost) {
        document.getElementById('host-controls').style.display = 'flex';
        document.getElementById('waiting-host').style.display = 'none';
    } else {
        document.getElementById('host-controls').style.display = 'none';
        document.getElementById('waiting-host').style.display = 'block';
    }

    buildArena(data.mapData, data.players);
});

socket.on('spleefRestarted', (data) => {
    document.getElementById('game-over-modal').style.display = 'none';
    buildArena(data.mapData, data.players);
});

socket.on('newPlayer', (playerInfo) => { if (playerInfo.isAlive) renderNewEnemy(playerInfo); });

socket.on('playerMoved', (playerInfo) => {
    if (otherPlayers[playerInfo.id]) {
        otherPlayers[playerInfo.id].position.set(playerInfo.x, playerInfo.y, playerInfo.z);
    }
});

socket.on('playerDisconnected', (id) => {
    if (otherPlayers[id]) {
        scene.remove(otherPlayers[id]);
        delete otherPlayers[id];
    }
});

socket.on('blockBroken', (data) => {
    serverMap[data.row][data.col] = 0;
    const block = blocksMap[`${data.row}-${data.col}`];
    if (block) {
        scene.remove(block);
        delete blocksMap[`${data.row}-${data.col}`];
    }
});

// EVENTI GAME OVER E MENU
socket.on('gameOver', (data) => {
    isDead = true;

    // Sblocca forzatamente il mouse
    if (document.exitPointerLock) document.exitPointerLock();

    const modal = document.getElementById('game-over-modal');
    const title = document.getElementById('winner-text');
    const sub = document.getElementById('winner-sub');

    if (data.winner) {
        title.textContent = "Partita Terminata!";
        title.style.color = data.winner.color;
        sub.textContent = data.winner.id === myId ? "🏆 HAI VINTO!" : "Un avversario è sopravvissuto!";
    } else {
        title.textContent = "Game Over";
        title.style.color = "#e74c3c";
        sub.textContent = "Siete precipitati nel vuoto!";
    }
    modal.style.display = 'flex';
});

// Listener per i bottoni (Solo Host li vede)
document.getElementById('btn-restart').addEventListener('click', () => {
    socket.emit('restartSpleef', lobbyId);
});

document.getElementById('btn-lobby').addEventListener('click', () => {
    socket.emit('forceReturnToLobby', lobbyId); // Usa l'evento globale del SocketManager
});

socket.on('redirectAllToLobby', () => {
    window.location.href = `/lobby.html?lobby=${lobbyId}&color=${encodeURIComponent(myColor)}`;
});

function renderNewEnemy(playerInfo) {
    const enemyGeo = new THREE.BoxGeometry(2, 4, 2);
    const enemyMat = new THREE.MeshStandardMaterial({ color: playerInfo.color });
    const enemyMesh = new THREE.Mesh(enemyGeo, enemyMat);
    enemyMesh.position.set(playerInfo.x, playerInfo.y, playerInfo.z);
    scene.add(enemyMesh);
    otherPlayers[playerInfo.id] = enemyMesh;
}

// --- CONTROLLI E MOVIMENTO ---
let yaw = 0; let pitch = 0;

window.addEventListener('click', (e) => {
    // Non bloccare il mouse se clicchiamo sui pulsanti del modale
    if (e.target.tagName === 'BUTTON' || isDead) return;
    renderer.domElement.requestPointerLock();
});

document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === renderer.domElement && !isDead) {
        yaw -= e.movementX * 0.0025;
        pitch -= e.movementY * 0.0025;
        pitch = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, pitch));

        myPlayer.rotation.y = yaw;
        camera.rotation.x = pitch;
    }
});

const raycaster = new THREE.Raycaster();
const boxGeo = new THREE.BoxGeometry(blockSize + 0.05, blockSize + 0.05, blockSize + 0.05);
const edges = new THREE.EdgesGeometry(boxGeo);
const highlightBox = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000, linewidth: 2 }));
highlightBox.visible = false;
scene.add(highlightBox);

let targetedBlock = null;

window.addEventListener('mousedown', () => {
    if (document.pointerLockElement !== renderer.domElement || isDead) return;

    if (targetedBlock) {
        socket.emit('breakBlock', { lobbyId, row: targetedBlock.userData.row, col: targetedBlock.userData.col });
    }
});

const keys = { w: false, a: false, s: false, d: false, space: false, shift: false };
document.addEventListener('keydown', (e) => keys[e.key.toLowerCase() === ' ' ? 'space' : e.key.toLowerCase()] = true);
document.addEventListener('keyup', (e) => keys[e.key.toLowerCase() === ' ' ? 'space' : e.key.toLowerCase()] = false);

let velocityY = 0;
const gravity = -0.015;
let isDead = false;

function animate() {
    requestAnimationFrame(animate);

    if (document.pointerLockElement === renderer.domElement && serverMap.length > 0 && !isDead) {
        raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
        const intersects = raycaster.intersectObjects(Object.values(blocksMap));

        if (intersects.length > 0) {
            const block = intersects[0].object;
            const playerCol = Math.round(myPlayer.position.x / blockSize);
            const playerRow = Math.round(myPlayer.position.z / blockSize);

            if (Math.abs(playerCol - block.userData.col) <= 2 && Math.abs(playerRow - block.userData.row) <= 2) {
                highlightBox.position.copy(block.position);
                highlightBox.visible = true;
                targetedBlock = block;
            } else {
                highlightBox.visible = false; targetedBlock = null;
            }
        } else {
            highlightBox.visible = false; targetedBlock = null;
        }
    } else {
        highlightBox.visible = false; targetedBlock = null;
    }

    if (!isDead && serverMap.length > 0) {
        const currentSpeed = keys.shift ? 0.35 : 0.18;
        const moveVector = new THREE.Vector3();

        if (keys.w) moveVector.z -= 1;
        if (keys.s) moveVector.z += 1;
        if (keys.a) moveVector.x -= 1;
        if (keys.d) moveVector.x += 1;

        if (moveVector.lengthSq() > 0) {
            moveVector.normalize();
            moveVector.applyQuaternion(myPlayer.quaternion);
            moveVector.multiplyScalar(currentSpeed);
            myPlayer.position.x += moveVector.x;
            myPlayer.position.z += moveVector.z;
        }

        velocityY += gravity;
        myPlayer.position.y += velocityY;

        const currentCol = Math.round(myPlayer.position.x / blockSize);
        const currentRow = Math.round(myPlayer.position.z / blockSize);
        const isStandingOnBlock = serverMap[currentRow] && serverMap[currentRow][currentCol] === 1;

        if (isStandingOnBlock && myPlayer.position.y <= 0) {
            myPlayer.position.y = 0;
            velocityY = 0;
            if (keys.space) velocityY = 0.32;
        }
        else if (myPlayer.position.y < -20) {
            isDead = true; // Previeni rimbalzi d'invio
            socket.emit('playerDied', lobbyId);
        }

        socket.emit('spleefMovement', {
            lobbyId: lobbyId,
            x: myPlayer.position.x, y: myPlayer.position.y, z: myPlayer.position.z
        });
    }

    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

animate();