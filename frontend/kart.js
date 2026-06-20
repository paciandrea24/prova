const socket = io();
const urlParams = new URLSearchParams(window.location.search);
const lobbyId = urlParams.get('lobbyId') || 'default-lobby';

// 1. SETUP THREE.JS
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb); // Cielo azzurro

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Luci
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(100, 100, 50);
scene.add(dirLight);


// 2. IL MIO KART
// Creiamo un contenitore vuoto che farà da "Hitbox" per la fisica
const myKart = new THREE.Group();
myKart.position.y = 0.5;
scene.add(myKart);

// Inizializziamo il caricatore
const gltfLoader = new THREE.GLTFLoader();

// Carichiamo il modello 3D
gltfLoader.load('/assets/kart.glb', (gltf) => {
    const kartModel = gltf.scene;

    // IMPORTANTE: I modelli scaricati da internet spesso hanno 
    // dimensioni enormi o sono girati al contrario.
    // Modifica questi valori se vedi il kart troppo grande o storto:
    kartModel.scale.set(0.3, 0.3, 0.3);

    // Se il kart viaggia in retromarcia o di lato visivamente, ruotalo qui!
    // kartModel.rotation.y = Math.PI; // (Ruota di 180 gradi)

    // Se vuoi colorare il kart del tuo colore assegnato dal server:
    kartModel.traverse((child) => {
        if (child.isMesh) {
            // Aggiunge le ombre e una tinta rossa (o del colore che preferisci)
            child.castShadow = true;
            // child.material.color.setHex(0xff0000); // Rimuovi i commenti per colorarlo
        }
    });

    // Inseriamo il modello 3D dentro il nostro gruppo invisibile!
    myKart.add(kartModel);
}, undefined, (error) => {
    console.error('Errore nel caricamento del modello:', error);
});

myKart.position.y = 0.5;
scene.add(myKart);

// Aggiungiamo i gruppi di tile per farli riconoscere a Three.js
const TILE_GROUPS = {
    GRASS: [245],
    TRACK: [149, 185, 183, 75, 94, 202, 166, 130, 93, 75, 131, 148, 184, 58, 59, 77],
    // Trattiamo la ghiaia o i blocchi sconosciuti come muri/ostacoli
    WALLS: [226, 257, 279, 152, 261, 225, 153, 208, 170, 243, 260, 207, 153, 171]
};

const collidableObjects = []; // Qui salviamo i muri per le collisioni fisiche

// frontend/kart.js

// Trova e sostituisci solo la funzione buildTrack con questa:

function buildTrack(mapMatrix) {
    const blockSize = 10;

    const offsetX = (mapMatrix[0].length * blockSize) / 2;
    const offsetZ = (mapMatrix.length * blockSize) / 2;

    // Colori di base
    const trackMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 }); // Asfalto
    const grassMaterial = new THREE.MeshStandardMaterial({ color: 0x27ae60 }); // Erba
    const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xe74c3c });  // Muri (rossi per risaltare)

    const floorGeo = new THREE.BoxGeometry(blockSize, 0.5, blockSize);
    const wallGeo = new THREE.BoxGeometry(blockSize, 4, blockSize);

    for (let row = 0; row < mapMatrix.length; row++) {
        for (let col = 0; col < mapMatrix[row].length; col++) {
            const tileCode = mapMatrix[row][col];

            const x = (col * blockSize) - offsetX;
            const z = (row * blockSize) - offsetZ;

            if (tileCode === 0) {
                // 0: STRADA (Asfalto piatto)
                const block = new THREE.Mesh(floorGeo, trackMaterial);
                block.position.set(x, 0, z);
                block.receiveShadow = true;
                scene.add(block);
            }
            else if (tileCode === 1) {
                // 1: ERBA (Prato piatto)
                const block = new THREE.Mesh(floorGeo, grassMaterial);
                block.position.set(x, 0, z);
                block.receiveShadow = true;
                scene.add(block);
            }
            else if (tileCode === 2) {
                // 2: MURO (Ostacolo 3D fisico)
                const block = new THREE.Mesh(wallGeo, wallMaterial);
                block.position.set(x, 2, z);
                block.castShadow = true;
                scene.add(block);

                // Aggiungiamo solo i muri all'array delle collisioni!
                collidableObjects.push(block);
            }
        }
    }
}

// 1. Diciamo al server che siamo entrati
socket.emit('joinKartGame', lobbyId);

// 2. Il server ci risponde con i dati per montare il mondo
socket.on('kartSetup', (data) => {
    console.log("Dati ricevuti dal server:", data); // <-- AGGIUNGI QUESTO

    if (!data.trackMap) {
        console.error("ERRORE: La mappa non è arrivata al client!");
        return;
    }

    buildTrack(data.trackMap);

    // Posizioniamo il nostro kart nel punto di spawn
    myKart.position.x = data.spawn.x;
    myKart.position.z = data.spawn.z;

    // Generiamo le mesh degli altri giocatori già presenti
    Object.keys(data.players).forEach((id) => {
        if (id !== socket.id) {
            addOtherKart(data.players[id]);
        }
    });
});

// 3. CONTROLLI TASTIERA
const keys = { w: false, a: false, s: false, d: false };
document.addEventListener('keydown', (e) => keys[e.key.toLowerCase()] = true);
document.addEventListener('keyup', (e) => keys[e.key.toLowerCase()] = false);

// NUOVO: Variabile per tracciare quale telecamera stiamo usando
let isFirstPerson = false;

// NUOVO: Ascoltatore per cambiare la visuale premendo il tasto "C"
document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'c') {
        isFirstPerson = !isFirstPerson; // Inverte lo stato (da true a false e viceversa)
    }
});

// Variabili fisiche di base
let speed = 0;
const maxSpeed = 0.6;       // Leggermente ridotta
const acceleration = 0.015; // Accelerazione più dolce
const friction = 0.01;      // Attrito normale

// Variabili per lo sterzo e il drift (derapata)
let velocity = new THREE.Vector3(0, 0, 0); // Vettore velocità reale
const turnSpeed = 0.04;     // Quanto gira velocemente
const grip = 0.92;          // Grip (aderenza). 1 = treno sui binari, 0 = ghiaccio puro

// 4. LOOP DI GIOCO
function animate() {
    requestAnimationFrame(animate);

    // 1. GESTIONE ACCELERATORE E FRENO (Modifica 'speed' desiderata)
    if (keys.w) speed = Math.min(speed + acceleration, maxSpeed);
    else if (keys.s) speed = Math.max(speed - acceleration, -maxSpeed / 2);
    else {
        // Attrito quando non premi nulla
        if (speed > 0) speed = Math.max(speed - friction, 0);
        if (speed < 0) speed = Math.min(speed + friction, 0);
    }

    // 2. GESTIONE STERZO (Scollegato dall'acceleratore, ma dipendente dalla velocità)
    // Più vai veloce, meglio curvi, ma puoi girare un po' anche da fermo
    const isMoving = Math.abs(speed) > 0.001 || velocity.lengthSq() > 0.001;
    if (isMoving) {
        // Inverti sterzo in retromarcia
        const turnMult = speed >= 0 ? 1 : -1;
        if (keys.a) myKart.rotation.y += turnSpeed * turnMult;
        if (keys.d) myKart.rotation.y -= turnSpeed * turnMult;
    }

    // 3. CALCOLO DELLA FISICA "DRIFT"
    // Vettore della direzione in cui il muso del kart sta puntando
    const forwardDirection = new THREE.Vector3(
        Math.sin(myKart.rotation.y),
        0,
        Math.cos(myKart.rotation.y)
    );

    // La "forza motore" applicata in questo frame
    const engineForce = forwardDirection.clone().multiplyScalar(speed);

    // La Magia del Grip: 
    // La nuova velocità è un mix tra "dove sto già andando" e "dove sto puntando"
    velocity.lerp(engineForce, grip);

    // Calcoliamo di quanto ci sposteremo
    const deltaX = velocity.x;
    const deltaZ = velocity.z;

    // 4. GESTIONE COLLISIONI DEFINITIVA (Separated Axis Theorem)

    // Creiamo una hitbox (scatola) fissa in base alla grandezza del nostro kart (2x1x3)
    // La rendiamo infinitesimamente più piccola (0.9 e 1.4) del modello reale
    // per non farla scontrate con le imperfezioni, ma senza farla entrare nei muri.
    const kartHalfWidth = 0.9;
    const kartHalfDepth = 1.4;

    // Funzione per testare se una coordinata futura tocca un muro
    function checkCollisionAt(x, z) {
        const testBox = new THREE.Box3(
            new THREE.Vector3(x - kartHalfWidth, 0, z - kartHalfDepth),
            new THREE.Vector3(x + kartHalfWidth, 2, z + kartHalfDepth)
        );

        for (let i = 0; i < collidableObjects.length; i++) {
            // Otteniamo la scatola del muro (aggiornata una volta sola in realtà, ma va bene così)
            const wallBox = new THREE.Box3().setFromObject(collidableObjects[i]);
            if (testBox.intersectsBox(wallBox)) {
                return true; // Trovato un muro!
            }
        }
        return false; // Strada libera
    }

    // Le coordinate future dove vorremmo andare
    const futureX = myKart.position.x + deltaX;
    const futureZ = myKart.position.z + deltaZ;

    let moveX = deltaX;
    let moveZ = deltaZ;

    // TESTIAMO L'ASSE X
    if (checkCollisionAt(futureX, myKart.position.z)) {
        moveX = 0;         // Annulla il movimento su X
        velocity.x = 0;    // Ferma l'inerzia su quell'asse
        speed *= 0.95;     // L'attrito contro il muro ti rallenta leggermente
    }

    // TESTIAMO L'ASSE Z
    if (checkCollisionAt(myKart.position.x + moveX, futureZ)) {
        moveZ = 0;         // Annulla il movimento su Z
        velocity.z = 0;    // Ferma l'inerzia su quell'asse
        speed *= 0.95;
    }

    // CONTROLLO ANTI-INCASTRO DI EMERGENZA
    // Se, per colpa di un caricamento o lag, finisci DENTRO il muro
    if (checkCollisionAt(myKart.position.x, myKart.position.z)) {
        // Usa la retromarcia forzata per spingerti fuori
        moveX = -Math.sin(myKart.rotation.y) * 0.2;
        moveZ = -Math.cos(myKart.rotation.y) * 0.2;
        speed = 0;
    }

    // 5. APPLICHIAMO LO SPOSTAMENTO SICURO
    myKart.position.x += moveX;
    myKart.position.z += moveZ;

    // 5. GESTIONE DELLA TELECAMERA (Switch Terza / Prima Persona)
    if (isFirstPerson) {
        // --- TELECAMERA IN PRIMA PERSONA ---
        // Posizioniamo la telecamera all'altezza degli occhi del pilota 
        // (Y: 1.2) e leggermente in avanti sul muso (Z: 1)
        const fpvCameraOffset = new THREE.Vector3(0, 1.2, 1);
        const cameraPos = fpvCameraOffset.applyMatrix4(myKart.matrixWorld);
        camera.position.copy(cameraPos);

        // Diciamo alla telecamera di guardare un punto fisso MOLTO avanti rispetto al kart
        const fpvTargetOffset = new THREE.Vector3(0, 1.2, 50);
        const targetPos = fpvTargetOffset.applyMatrix4(myKart.matrixWorld);
        camera.lookAt(targetPos);
    } else {
        // --- TELECAMERA IN TERZA PERSONA (Originale) ---
        // Posizioniamo la telecamera in alto (Y: 5) e dietro al kart (Z: -10)
        const tpvCameraOffset = new THREE.Vector3(0, 5, -10);
        const cameraPos = tpvCameraOffset.applyMatrix4(myKart.matrixWorld);
        camera.position.copy(cameraPos);

        // La telecamera guarda direttamente il centro del kart
        camera.lookAt(myKart.position);
    }

    // INVIA DATI AL SERVER
    if (Math.abs(speed) > 0 || keys.a || keys.d || velocity.lengthSq() > 0.001) {
        socket.emit('kartMovement', {
            lobbyId: lobbyId,
            x: myKart.position.x,
            y: myKart.position.y,
            z: myKart.position.z,
            rotationY: myKart.rotation.y
        });
    }

    renderer.render(scene, camera);
}
animate();



const otherKarts = {};


// Quando un nuovo giocatore entra
socket.on('newPlayer', (playerInfo) => {
    addOtherKart(playerInfo);
});

// Quando un giocatore si disconnette
socket.on('playerDisconnected', (id) => {
    if (otherKarts[id]) {
        scene.remove(otherKarts[id]);
        delete otherKarts[id];
    }
});

// Quando riceviamo la posizione aggiornata di un avversario
socket.on('playerMoved', (playerInfo) => {
    if (otherKarts[playerInfo.id]) {
        otherKarts[playerInfo.id].position.set(playerInfo.x, playerInfo.y, playerInfo.z);
        otherKarts[playerInfo.id].rotation.y = playerInfo.rotationY;
    }
});

function addOtherKart(playerInfo) {
    // Creiamo il contenitore per l'avversario
    const kartGroup = new THREE.Group();
    kartGroup.position.set(playerInfo.x, playerInfo.y, playerInfo.z);
    kartGroup.rotation.y = playerInfo.rotationY;
    scene.add(kartGroup);

    otherKarts[playerInfo.id] = kartGroup;

    // Carichiamo il modello per l'avversario
    gltfLoader.load('/assets/kart.glb', (gltf) => {
        const kartModel = gltf.scene;

        // Applica le stesse scale/rotazioni che hai messo per il tuo kart
        kartModel.scale.set(1, 1, 1);

        // Coloriamo la carrozzeria col colore dell'avversario
        kartModel.traverse((child) => {
            if (child.isMesh) {
                // clona il materiale per non colorare tutti i kart uguali
                child.material = child.material.clone();
                child.material.color.setHex(playerInfo.color);
            }
        });

        kartGroup.add(kartModel);
    });
}