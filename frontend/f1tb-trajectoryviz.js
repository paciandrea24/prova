// frontend/f1tb-trajectoryviz.js
//
// Debug visuale traiettoria banco prova (Rif.
// docs/superpowers/specs/2026-07-28-f1-bot-testbench-debug-design.md):
// disegna in scena il target/lookahead già scelto dal bot (_botDebug.target,
// stesso punto usato da steerToward in backend/sockets/games/f1Bot.js) e,
// se disponibile, la racing line precalcolata della pista. SOLA
// VISUALIZZAZIONE: nessun dato qui influenza la guida del bot, che continua
// a decidere esattamente come nel gioco vero (vera tickGame, nessuna
// simulazione parallela).
window.TrajectoryViz = (function () {
    let scene = null;
    let targetMarker = null, targetLine = null, waypointMarker = null, racingLineObj = null;

    function init(threeScene) {
        scene = threeScene;

        // depthTest:false + renderOrder alto: i marker restano sempre visibili
        // sopra pista/scenografia, non è un effetto di gioco, solo debug.
        const targetMat = new THREE.MeshBasicMaterial({ color: 0xff3355, depthTest: false });
        targetMarker = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 12), targetMat);
        targetMarker.renderOrder = 999;
        targetMarker.visible = false;
        scene.add(targetMarker);

        const wpMat = new THREE.MeshBasicMaterial({ color: 0x33ccff, depthTest: false });
        waypointMarker = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 12), wpMat);
        waypointMarker.renderOrder = 999;
        waypointMarker.visible = false;
        scene.add(waypointMarker);

        const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
        const lineMat = new THREE.LineBasicMaterial({ color: 0xff3355, depthTest: false, transparent: true, opacity: 0.85 });
        targetLine = new THREE.Line(lineGeo, lineMat);
        targetLine.renderOrder = 998;
        targetLine.visible = false;
        scene.add(targetLine);
    }

    // points: array di {x,z} già campionati (track.racingLine dal server) o
    // null/vuoto se la pista non ne ha una precalcolata (fallback geometrico
    // a runtime — vedi f1Bot.js, nessuna racing line da disegnare in quel caso).
    function setRacingLine(points) {
        if (racingLineObj) {
            scene.remove(racingLineObj);
            racingLineObj.geometry.dispose();
            racingLineObj.material.dispose();
            racingLineObj = null;
        }
        if (!points || points.length === 0) return;
        const vecs = points.map(p => new THREE.Vector3(p.x, 0.12, p.z));
        vecs.push(vecs[0].clone());   // richiude il giro
        const geo = new THREE.BufferGeometry().setFromPoints(vecs);
        const mat = new THREE.LineBasicMaterial({ color: 0xffee55, depthTest: false, transparent: true, opacity: 0.7 });
        racingLineObj = new THREE.Line(geo, mat);
        racingLineObj.renderOrder = 997;
        scene.add(racingLineObj);
    }

    // carPos: {x,z} posizione VISIVA (interpolata) dell'auto seguita —
    // coerente con dove si vede davvero l'auto, non la posizione server
    // grezza di un tick fa. target: _botDebug.target ({x,z} o null).
    // waypoint: punto sulla linea seguita al trackIndex corrente ({x,z} o null).
    function update(carPos, target, waypoint) {
        if (target && carPos) {
            targetMarker.visible = true;
            targetMarker.position.set(target.x, 0.6, target.z);
            targetLine.visible = true;
            const pos = targetLine.geometry.attributes.position;
            pos.setXYZ(0, carPos.x, 0.5, carPos.z);
            pos.setXYZ(1, target.x, 0.6, target.z);
            pos.needsUpdate = true;
        } else {
            targetMarker.visible = false;
            targetLine.visible = false;
        }

        if (waypoint) {
            waypointMarker.visible = true;
            waypointMarker.position.set(waypoint.x, 0.45, waypoint.z);
        } else {
            waypointMarker.visible = false;
        }
    }

    function hide() {
        targetMarker.visible = false;
        targetLine.visible = false;
        waypointMarker.visible = false;
    }

    return { init, setRacingLine, update, hide };
})();
