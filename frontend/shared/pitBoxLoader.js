// frontend/shared/pitBoxLoader.js
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./trackGeometry.js'));
    else root.PitBoxLoader = factory(root.TrackGeometry);
})(typeof self !== 'undefined' ? self : this, function (TrackGeometry) {

    // Modello voxel custom generato da backend/tools/circuitAssets/pitBox.py
    // (vedi docs/f1-notes.md, sezione "Asset voxel del circuito"). Sostituisce
    // il vecchio /assets/custom/f1PitBox.glb, che era modellato a scala 3.5x
    // e col fronte lungo +X. Questo rispetta le convenzioni del catalogo:
    // scala 1:1 in unità di gioco e fronte verso +Z locale, quindi niente
    // fattore di scala e niente correzione di rotazione.
    const MODEL_URL = '/assets/custom/circuit/pitBox.glb';

    // Il ricolore per giocatore agisce sul MATERIALE il cui nome finisce per
    // "_livery" (unico nel modello). Prima si campionava una texture palette
    // 256x1 cercando i texel "abbastanza rossi" con soglie di tinta e
    // saturazione, e si riscriveva la texture su un canvas: tecnica necessaria
    // finché il modello era texturizzato, ma fragile (bastava un rosso di
    // troppo nella palette per ricolorare la cosa sbagliata) e costosa a ogni
    // caricamento. Il modello nuovo usa materiali flat, quindi basta cambiare
    // il colore del materiale giusto.
    const LIVERY_MATERIAL_RE = /_livery$/i;

    // Distanza dal centro del box al suo FRONTE, misurata sul .glb reale
    // (profondità totale 22 unità, origine al centro): serve a piazzare il
    // box arretrato rispetto alla corsia, così il garage resta dietro lo
    // stallo dove l'auto si ferma davvero.
    const PIT_BOX_FRONT_HALF_DEPTH = 11;
    // PIT_BOX_CLEARANCE = distanza del FRONTE del garage dal bordo corsia
    // (pitRoadHalf) — deve restare sempre maggiore di
    // TrackGeometry.PIT_STALL_CLEARANCE (dove si ferma davvero l'auto), con
    // un margine di qualche metro, così il garage resta "subito dietro" lo
    // stallo, mai sovrapposto (Rif. richiesta utente 2026-08-07, 2° round:
    // "spingere la schiera di box più indietro").
    const PIT_BOX_CLEARANCE = 12;
    const PIT_BOX_OFFSET_MARGIN = PIT_BOX_FRONT_HALF_DEPTH + PIT_BOX_CLEARANCE;

    // Dimensioni della segnaletica a terra dello stallo (rettangolo
    // colorato dove l'auto si ferma davvero — Rif. richiesta utente
    // 2026-08-07, "gli stalli a terra"): larghezza (asse laterale) e
    // lunghezza (asse lungo la corsia, l'auto si ferma parallela al senso
    // di marcia) leggermente più ampie dell'ingombro reale dell'auto
    // (CAR_HALF_WIDTH*2≈3.48, CAR_HALF_LENGTH*2≈7.16 —
    // backend/sockets/games/physics/CollisionResolver.js) per un margine
    // visivo, non misurate su un asset — nessun modello 3D coinvolto, solo
    // una decalcomania piatta.
    const STALL_WIDTH = 5;
    const STALL_LENGTH = 10;

    function isLiveryMaterialName(name) {
        return LIVERY_MATERIAL_RE.test(name || '');
    }

    // Applica il colore del giocatore alle sole superfici "livrea". Il
    // materiale va sempre clonato, anche quando non è livrea: il GLTFLoader
    // condivide le istanze di materiale fra tutti i box caricati, quindi
    // scriverci sopra cambierebbe il colore anche agli altri piloti.
    function applyLiveryColor(model, hex) {
        model.traverse((child) => {
            if (!child.isMesh) return;
            child.castShadow = true;
            child.receiveShadow = true;
            child.material = child.material.clone();
            if (isLiveryMaterialName(child.material.name)) {
                child.material.color.setHex(hex);
                child.material.needsUpdate = true;
            }
        });
    }

    // Carica un box colorato indipendente per un giocatore. placement =
    // { x, y, z, rotY } già calcolato dal chiamante (frontend/f1.js:
    // offset laterale dalla corsia + rotazione verso di essa, stessa
    // tecnica di trackScenery.js::buildPaddockLayout) — questo modulo si
    // occupa solo di caricare/ricolorare/posizionare il modello, non della
    // geometria della corsia box. Niente InstancedMesh/materiale condiviso
    // come per la scenografia decorativa (loadScenery in f1.js): ogni box
    // ha un colore diverso.
    // onError (opzionale): senza, un fallimento di caricamento (rete,
    // 404...) restava un console.error muto — combinato con la guardia
    // pendingPitBoxLoads lato chiamante (frontend/f1.js), quel colore non
    // veniva MAI più ritentato per il resto della gara (box mancante in
    // permanenza). Chiamato al posto di — non in aggiunta a — console.error,
    // così il chiamante può liberare la propria guardia e ritentare al
    // prossimo state update, mantenendo comunque un log.
    function loadPitBoxModel(playerColor, placement, onReady, onError) {
        const loader = new THREE.GLTFLoader();
        const hex = parseInt(playerColor.replace('#', ''), 16);
        loader.load(MODEL_URL, (gltf) => {
            const model = gltf.scene;
            // Nessuno scale: il modello è già in unità di gioco.
            applyLiveryColor(model, hex);
            model.position.set(placement.x, placement.y || 0, placement.z);
            // Nessuna correzione di rotazione: il fronte del modello guarda
            // +Z locale, che è la convenzione assunta da rotY nel resto del
            // progetto (il vecchio modello aveva l'apertura lungo +X e
            // richiedeva -90°).
            model.rotation.y = placement.rotY;
            onReady(model);
        }, undefined, (err) => {
            console.error('[F1] Errore caricando pitBox.glb:', err);
            if (onError) onError(err);
        });
    }

    // Meccanici davanti al box. Sono modellati (pitCrew, pitCrewKneel) ma non
    // erano cablati da nessuna parte: senza di loro il box resta un garage
    // vuoto, e il circuito non sembra "vivo" (Rif. richiesta utente
    // 2026-08-09). Posizioni in coordinate MONDO, ricavate dalla posizione del
    // box e dalla sua rotazione: il fronte guarda +Z locale, convenzione di
    // tutto il catalogo custom.
    //
    // Restano statici: l'animazione è fuori scope, i modelli non sono
    // animabili così come sono (vedi la nota in testa a
    // backend/tools/circuitAssets/people.py).
    //
    // Distanza dell'AUTO FERMA dal centro del box, in coordinate locali (lz
    // cresce verso la corsia). DERIVATA e non ricopiata: lo stallo sta a
    // pitRoadHalf + PIT_STALL_CLEARANCE dall'asse corsia e il box a
    // pitRoadHalf + PIT_BOX_OFFSET_MARGIN, quindi la loro distanza non dipende
    // dalla larghezza della corsia e vale la differenza dei due margini.
    // Scriverla a mano significherebbe doverla ricordare se una delle due
    // cambia.
    const STALL_LZ = PIT_BOX_OFFSET_MARGIN - TrackGeometry.PIT_STALL_CLEARANCE;
    // Ingombro dell'auto ferma nello stallo, parallela alla corsia (vedi
    // CAR_HALF_LENGTH/CAR_HALF_WIDTH in physics/CollisionResolver.js): la sua
    // LUNGHEZZA corre lungo lx (parallela alla corsia), la larghezza lungo lz.
    const CAR_HALF_LENGTH = 3.58;
    const CAR_HALF_WIDTH = 1.74;

    // I meccanici sono modellati a scala 1 come tutto il catalogo, ma a quella
    // scala si perdono accanto a un'auto lunga 7.16 — stesso motivo per cui
    // gli asset Kenney furono portati da 3.5x a 6x (vedi trackScenery.js): in
    // terza persona conta la presenza scenica, non il rapporto esatto.
    const CREW_SCALE = 1.25;

    // Posizioni locali. Il vincolo che le governa: NESSUNA deve cadere dentro
    // l'ingombro dell'auto ferma — i due inginocchiati stavano esattamente
    // sopra lo stallo (lz 13 = STALL_LZ) e si vedevano spuntare dentro la
    // macchina (segnalato dall'utente 2026-08-10).
    //   - inginocchiati: a fianco del muso e della coda, appena oltre la
    //     semilunghezza dell'auto, all'altezza dello stallo;
    //   - in piedi: dietro l'auto, verso il garage;
    //   - uno arretrato sotto il portale.
    const CREW_LAYOUT = [
        { asset: 'pitCrewKneel', lx: -(CAR_HALF_LENGTH + 0.75), lz: STALL_LZ },
        { asset: 'pitCrewKneel', lx: CAR_HALF_LENGTH + 0.75,    lz: STALL_LZ },
        { asset: 'pitCrew',      lx: -2.2, lz: STALL_LZ - CAR_HALF_WIDTH - 1.3 },
        { asset: 'pitCrew',      lx: 2.2,  lz: STALL_LZ - CAR_HALF_WIDTH - 1.3 },
        { asset: 'pitCrew',      lx: 0,    lz: STALL_LZ - CAR_HALF_WIDTH - 2.6 },
    ];

    function crewPlacements(placement) {
        const cos = Math.cos(placement.rotY || 0), sin = Math.sin(placement.rotY || 0);
        return CREW_LAYOUT.map(function (c) {
            return {
                asset: c.asset,
                // Stessa trasformazione applicata da THREE.Object3D.rotation.y,
                // identica a quella di sceneryCrowd.js per i posti in tribuna.
                x: placement.x + c.lx * cos + c.lz * sin,
                z: placement.z - c.lx * sin + c.lz * cos,
                y: placement.y || 0,
                // Guardano nella stessa direzione del box, cioè verso la corsia.
                rotY: placement.rotY || 0,
                scale: CREW_SCALE,
            };
        });
    }

    return {
        loadPitBoxModel, applyLiveryColor, isLiveryMaterialName, crewPlacements,
        PIT_BOX_OFFSET_MARGIN, PIT_BOX_FRONT_HALF_DEPTH, STALL_WIDTH, STALL_LENGTH,
        STALL_LZ, CREW_SCALE, CAR_HALF_LENGTH, CAR_HALF_WIDTH,
    };
});
