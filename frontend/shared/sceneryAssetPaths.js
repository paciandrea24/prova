// frontend/shared/sceneryAssetPaths.js
//
// Dove sta il modello di ogni asset scenico. UNA tabella sola: se ne
// esistessero due, un asset nuovo comparirebbe in gara e non nell'anteprima —
// o peggio, comparirebbe in entrambe con due modelli diversi, che è il tipo di
// difetto che si nota solo guardando bene e che nessun test prende.
//
// I percorsi sono quelli che il browser chiede al server, quindi cominciano
// da `/assets/`: non sono percorsi di disco.
//
// Estratta da f1.js il 2026-08-24. Rif.
// docs/superpowers/specs/2026-08-24-f1-anteprima-esplorabile-design.md
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.SceneryAssetPaths = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    const PERCORSI = {
        // Alberi: unici Kenney rimasti, per scelta esplicita dell'utente, e
        // unici a essere istanziati con un moltiplicatore di scala.
        treeBroad: '/assets/custom/circuit/treeBroad.glb',
        treeYoung: '/assets/custom/circuit/treeYoung.glb',
        treePine: '/assets/custom/circuit/treePine.glb',
        treeRound: '/assets/custom/circuit/treeRound.glb',
        bushLow: '/assets/custom/circuit/bushLow.glb',
        bushTall: '/assets/custom/circuit/bushTall.glb',
        motorhome: '/assets/custom/circuit/motorhome.glb',
        truck: '/assets/custom/circuit/truck.glb',
        containerStack: '/assets/custom/circuit/containerStack.glb',
        parkedCarRed: '/assets/custom/circuit/parkedCarRed.glb',
        parkedCarBlue: '/assets/custom/circuit/parkedCarBlue.glb',
        parkedCarWhite: '/assets/custom/circuit/parkedCarWhite.glb',
        banner: '/assets/custom/circuit/banner.glb',
        spectatorStandA: '/assets/custom/circuit/spectatorStandA.glb',
        spectatorStandB: '/assets/custom/circuit/spectatorStandB.glb',
        rockSingle: '/assets/custom/circuit/rockSingle.glb',
        rockCluster: '/assets/custom/circuit/rockCluster.glb',
        treeLarge: '/assets/kenney/treeLarge.glb',
        treeSmall: '/assets/kenney/treeSmall.glb',
        // Catalogo voxel custom (vedi docs/f1-notes.md): modellati 1:1 in
        // unità di gioco, quindi istanziati con scale 1.
        grandStand: '/assets/custom/circuit/grandStand.glb',
        grandStandAwning: '/assets/custom/circuit/grandStandAwning.glb',
        grandStandCovered: '/assets/custom/circuit/grandStandCovered.glb',
        billboard: '/assets/custom/circuit/billboard.glb',
        billboardLow: '/assets/custom/circuit/billboardLow.glb',
        pitsGarageClosed: '/assets/custom/circuit/pitsGarageClosed.glb',
        pitsOffice: '/assets/custom/circuit/pitsOffice.glb',
        // Landmark unici (SceneryLandmarks): gantry e passerella vengono
        // scalati per scavalcare le barriere, gli altri restano a 1.
        raceControlTower: '/assets/custom/circuit/raceControlTower.glb',
        startGantry: '/assets/custom/circuit/startGantry.glb',
        podium: '/assets/custom/circuit/podium.glb',
        footbridge: '/assets/custom/circuit/footbridge.glb',
        // Elementi distribuiti lungo il giro (SceneryTrackside).
        tyreStack: '/assets/custom/circuit/tyreStack.glb',
        catchFence: '/assets/custom/circuit/catchFence.glb',
        marshalPost: '/assets/custom/circuit/marshalPost.glb',
        brakingBoard: '/assets/custom/circuit/brakingBoard.glb',
        concreteBarrier: '/assets/custom/circuit/concreteBarrier.glb',
        pylon: '/assets/custom/circuit/pylon.glb',
        flagPole: '/assets/custom/circuit/flagPole.glb',
        paddockTent: '/assets/custom/circuit/paddockTent.glb',
        // Spettatori (SceneryCrowd): tre varianti alternate per dare
        // varietà alla folla. Restano 12 InstancedMesh anche con centinaia
        // di figure.
        spectatorA: '/assets/custom/circuit/spectatorA.glb',
        spectatorB: '/assets/custom/circuit/spectatorB.glb',
        spectatorC: '/assets/custom/circuit/spectatorC.glb',
        // Infrastrutture di circuito (spec 2026-08-13): modellate 1:1 in unità
        // di gioco come gli altri custom, quindi istanziate con scale 1.
        giantScreen: '/assets/custom/circuit/giantScreen.glb',
        floodlightTower: '/assets/custom/circuit/floodlightTower.glb',
        hospitalityDeck: '/assets/custom/circuit/hospitalityDeck.glb',
        vipSuite: '/assets/custom/circuit/vipSuite.glb',
        serviceBuilding: '/assets/custom/circuit/serviceBuilding.glb',
        tvTower: '/assets/custom/circuit/tvTower.glb',
        recoveryCrane: '/assets/custom/circuit/recoveryCrane.glb',
        trackGate: '/assets/custom/circuit/trackGate.glb',
    };

    return { PERCORSI };
});
