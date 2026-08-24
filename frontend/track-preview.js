// frontend/track-preview.js
//
// GUARDARE LA PISTA CHE SI STA DISEGNANDO, con gli oggetti che ci saranno
// davvero, senza avviare una gara.
//
// Dettato dall'utente: «io creo il circuito e poi tramite un tasto posso
// entrare effettivamente in gioco e vedere tutto. mi interessa capire la
// disposizione degli edifici lungo la pista. mi devo poter muovere liberamente
// lungo la mappa, volare in giro. non serve renderizzare macchine. non serve
// neanche renderizzare luci, ombre o contorni. solo gli asset effettivi che
// troverò in gioco.»
// Rif. docs/superpowers/specs/2026-08-24-f1-anteprima-esplorabile-design.md
//
// ⚠️ LA SCENA NON SI COSTRUISCE QUI: la costruisce F1Scena.costruisciCircuito,
// la stessa funzione che usa il gioco. Se questa pagina ricostruisse la
// sequenza per conto suo, un giorno mostrerebbe una pista che in gara non
// esiste — ed è il difetto che rende un'anteprima peggio che inutile.
document.addEventListener('DOMContentLoaded', async () => {
    const elStato = document.getElementById('stato');
    const elNome = document.getElementById('nomePista');
    const dire = (testo) => { elStato.textContent = testo; };

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x8fbcd4);
    // Una luce piatta, e basta: senza direzionale non ci sono ombre da
    // calcolare, e i colori restano quelli dei .glb. È anche ciò che rende
    // questa pagina leggera abbastanza da girare mentre si disegna.
    scene.add(new THREE.HemisphereLight(0xffffff, 0x9a9a9a, 1.5));

    const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.5, 8000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(innerWidth, innerHeight);
    document.body.appendChild(renderer.domElement);
    addEventListener('resize', () => {
        camera.aspect = innerWidth / innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(innerWidth, innerHeight);
    });

    // --- La pista ---------------------------------------------------------
    // Arriva dall'editor senza passare dal disco: si guarda anche una pista
    // NON ancora salvata, che è il caso normale mentre la si disegna.
    let trackData = null;
    try {
        const grezzo = sessionStorage.getItem('f1AnteprimaPista');
        if (grezzo) trackData = JSON.parse(grezzo);
    } catch (e) { /* modalità privata: si ripiega sul parametro qui sotto */ }
    if (!trackData) {
        const id = new URLSearchParams(location.search).get('track') || 'prova';
        try {
            trackData = await (await fetch(`/tracks/${id}.json`)).json();
        } catch (e) {
            dire(`Non riesco a caricare la pista "${id}".`);
            return;
        }
    }
    elNome.textContent = trackData.name || trackData.id || 'senza nome';

    let circuito;
    try {
        circuito = await F1Scena.costruisciCircuito(scene, trackData, { gridSize: 6 });
    } catch (e) {
        dire('Il circuito non si costruisce: ' + e.message);
        return;
    }

    // --- Dove si parte ----------------------------------------------------
    // Sul TRAGUARDO, a quota d'uomo, guardando nel verso di marcia: è il punto
    // da cui si giudica una pista.
    const partenza = circuito.trackPts[circuito.startFinishIndex];
    const versoGara = TrackGeometry.tangentAt(circuito.trackPts, circuito.startFinishIndex, true);
    const ALTEZZA_OCCHI = 2.5;
    let imbardata = Math.atan2(versoGara.tx, versoGara.tz);
    let beccheggio = 0;

    function tornaSulTraguardo() {
        camera.position.set(partenza.x, (partenza.y || 0) + ALTEZZA_OCCHI, partenza.z);
        imbardata = Math.atan2(versoGara.tx, versoGara.tz);
        beccheggio = 0;
    }
    tornaSulTraguardo();

    // --- Il volo ----------------------------------------------------------
    const tasti = new Set();
    addEventListener('keydown', (e) => {
        tasti.add(e.code);
        if (e.code === 'KeyT') tornaSulTraguardo();
    });
    addEventListener('keyup', (e) => tasti.delete(e.code));

    const invito = document.getElementById('clicca');
    invito.addEventListener('click', () => renderer.domElement.requestPointerLock());
    document.addEventListener('pointerlockchange', () => {
        invito.classList.toggle('via', document.pointerLockElement === renderer.domElement);
    });
    addEventListener('mousemove', (e) => {
        if (document.pointerLockElement !== renderer.domElement) return;
        imbardata -= e.movementX * 0.0022;
        // Fermarsi prima della verticale: oltre, la camera si rovescia e non si
        // capisce più da che parte si sta guardando.
        beccheggio = Math.max(-1.4, Math.min(1.4, beccheggio - e.movementY * 0.0022));
    });

    const VELOCITA = 45;             // unità al secondo: una corsa veloce
    const MOLTIPLICATORE_CORSA = 5;  // con Shift si attraversa il circuito

    document.getElementById('tornaBtn').addEventListener('click', () => {
        location.href = 'track-editor.html';
    });

    // --- Gli asset --------------------------------------------------------
    // LO STESSO layout della gara: stessa funzione, stessi argomenti. Se
    // divergesse, l'anteprima mostrerebbe una scenografia che in gara non
    // esiste — che è esattamente il difetto che questa pagina esiste per
    // evitare.
    dire('Dispongo la scenografia…');
    let layout = [];
    try {
        const seats = await (await fetch('/assets/custom/circuit/grandStandSeats.json')).json();
        const terrazze = await (await fetch('/assets/custom/circuit/terraceAnchors.json')).json();
        // Una pista CONGELATA si rilegge invece di ricalcolarla, esattamente
        // come fa il gioco: se guardassi una scenografia rigenerata vedrei
        // altro rispetto alla gara.
        let cotta = null;
        try {
            const risposta = await fetch(`/tracks/scenografie/${trackData.id}.json`);
            if (risposta.ok) {
                const dati = await risposta.json();
                if (!ScenografiaCotta.motivoDiRifiuto(dati, trackData, 6)) cotta = ScenografiaCotta.espandi(dati);
            }
        } catch (e) { /* non congelata: si genera */ }

        layout = cotta || TrackScenery.generateLayout(trackData, circuito.trackPts, circuito.pitPts,
            circuito.barrierDist, F1Scena.EMBANKMENT_WIDTH, seats.seats,
            circuito.barrierProfile, terrazze.anchors, { gridSize: 6 });
    } catch (e) {
        dire('Scenografia non disponibile: ' + e.message);
    }

    // Un InstancedMesh per asset, senza divisione in celle e senza ombre: qui
    // non c'è un budget di frame da rispettare, c'è da guardarsi intorno.
    const perAsset = new Map();
    for (const voce of layout) {
        if (!voce.asset || voce.category === 'pond' || voce.category === 'parkingLot') continue;
        if (!perAsset.has(voce.asset)) perAsset.set(voce.asset, []);
        perAsset.get(voce.asset).push(voce);
    }

    const loader = new THREE.GLTFLoader();
    const dummy = new THREE.Object3D();
    let caricati = 0;
    const totale = perAsset.size;
    for (const [asset, voci] of perAsset) {
        const url = SceneryAssetPaths.PERCORSI[asset];
        if (!url) { console.warn(`[anteprima] asset senza modello: ${asset}`); continue; }
        loader.load(url, (gltf) => {
            gltf.scene.updateMatrixWorld(true);
            gltf.scene.traverse((child) => {
                if (!child.isMesh) return;
                const im = new THREE.InstancedMesh(child.geometry, child.material, voci.length);
                voci.forEach((v, i) => {
                    dummy.position.set(v.x, v.y || 0, v.z);
                    dummy.rotation.set(0, v.rotY || 0, 0);
                    dummy.scale.setScalar(v.scale || 1);
                    dummy.updateMatrix();
                    im.setMatrixAt(i, new THREE.Matrix4().multiplyMatrices(dummy.matrix, child.matrixWorld));
                });
                im.instanceMatrix.needsUpdate = true;
                scene.add(im);
            });
            caricati++;
            dire(`${layout.length} oggetti · ${caricati}/${totale} modelli`);
        }, undefined, () => {
            caricati++;
            console.warn(`[anteprima] non riesco a caricare ${url}`);
        });
    }
    if (!totale) dire(`${scene.children.length} elementi in scena`);

    // --- Il giro ----------------------------------------------------------
    let ultimo = performance.now();
    function anima() {
        requestAnimationFrame(anima);
        const ora = performance.now();
        const dt = Math.min(0.05, (ora - ultimo) / 1000);
        ultimo = ora;

        const passo = VELOCITA * dt * (tasti.has('ShiftLeft') || tasti.has('ShiftRight') ? MOLTIPLICATORE_CORSA : 1);
        const avanti = new THREE.Vector3(
            Math.sin(imbardata) * Math.cos(beccheggio),
            Math.sin(beccheggio),
            Math.cos(imbardata) * Math.cos(beccheggio));
        const destra = new THREE.Vector3(Math.sin(imbardata + Math.PI / 2), 0, Math.cos(imbardata + Math.PI / 2));

        if (tasti.has('KeyW')) camera.position.addScaledVector(avanti, passo);
        if (tasti.has('KeyS')) camera.position.addScaledVector(avanti, -passo);
        if (tasti.has('KeyD')) camera.position.addScaledVector(destra, passo);
        if (tasti.has('KeyA')) camera.position.addScaledVector(destra, -passo);
        if (tasti.has('KeyE')) camera.position.y += passo;
        if (tasti.has('KeyQ')) camera.position.y -= passo;

        camera.lookAt(camera.position.clone().add(avanti));
        renderer.render(scene, camera);
    }
    anima();
});
