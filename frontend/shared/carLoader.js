// frontend/shared/carLoader.js
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.CarLoader = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    // Ricolore per modelli con texture-palette (mesh voxel unica, colore dato
    // da una piccola texture invece che da material.color): si ricrea la
    // palette sostituendo SOLO i texel "rosso livrea" (tonalità in
    // [0, LIVERY_HUE_MAX], saturazione >= LIVERY_SAT_MIN — misurato sulla
    // palette reale del modello: i rossi livrea non superano mai 23.8° di
    // tonalità, i neri/grigi/ombre AO olive-marroni stanno da 32° in su —
    // soglia scelta nel mezzo di questo margine, altrimenti quelle ombre
    // vengono ricolorate per errore) con la stessa luminosità/saturazione
    // ma tonalità del colore giocatore, così l'ombreggiatura già cotta
    // nella palette resta intatta.
    const LIVERY_HUE_MAX = 28;
    const LIVERY_SAT_MIN = 0.2;

    // Lift di luminosità applicato a OGNI texel (nero, grigio o livrea),
    // stessa curva per tutti — misurato sulla palette reale: anche il "nero"
    // più chiaro non supera v=0.36, e molte ombre livrea stanno sotto v=0.15,
    // per questo in gioco auto propria e avversarie si leggono come un blob
    // scuro indistinguibile. Curva uniforme (nessun ramo per tonalità) per
    // non ripetere l'artefatto del tentativo precedente (floor applicato in
    // base alla classificazione hue → macchie sui texel ambigui 30-45°).
    const VALUE_LIFT_FLOOR = 0.14;
    const VALUE_LIFT_GAMMA = 0.55;
    function liftValue(v) {
        return VALUE_LIFT_FLOOR + (1 - VALUE_LIFT_FLOOR) * Math.pow(v, VALUE_LIFT_GAMMA);
    }

    // Alcuni texel non-livrea hanno un residuo di tonalità (giallo/oliva,
    // probabile artefatto di bake dell'AO) con saturazione non trascurabile:
    // finché erano scurissimi non si vedeva, ma il lift sopra li rende
    // luminosi abbastanza da leggersi come "voxel gialli" sulle gomme.
    // Spenta qui, solo per i texel non classificati come livrea.
    const BLACK_SAT_SCALE = 0.12;
    function desaturateForBlack(s) {
        return s * BLACK_SAT_SCALE;
    }

    function rgbToHsv(r, g, b) {
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const d = max - min;
        let h = 0;
        if (d !== 0) {
            if (max === r)      h = ((g - b) / d) % 6;
            else if (max === g) h = (b - r) / d + 2;
            else                h = (r - g) / d + 4;
            h *= 60;
            if (h < 0) h += 360;
        }
        const s = max === 0 ? 0 : d / max;
        return [h, s, max];
    }

    function hsvToRgb(h, s, v) {
        const c = v * s;
        const x = c * (1 - Math.abs((h / 60) % 2 - 1));
        const m = v - c;
        let r1, g1, b1;
        if      (h < 60)  [r1, g1, b1] = [c, x, 0];
        else if (h < 120) [r1, g1, b1] = [x, c, 0];
        else if (h < 180) [r1, g1, b1] = [0, c, x];
        else if (h < 240) [r1, g1, b1] = [0, x, c];
        else if (h < 300) [r1, g1, b1] = [x, 0, c];
        else              [r1, g1, b1] = [c, 0, x];
        return [r1 + m, g1 + m, b1 + m];
    }

    function recolorLiveryTexture(sourceTexture, hex) {
        const img = sourceTexture.image;
        const canvas = document.createElement('canvas');
        canvas.width  = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        // targetSat/targetVal: per i texel livrea la saturazione/luminosità
        // finali arrivano dal colore SCELTO dal giocatore, non dalla texture
        // sorgente (quasi sempre un rosso vivido) — altrimenti un colore
        // scuro/poco saturo come il marrone (#795548, H≈16° S≈0.40 V≈0.48,
        // tonalità vicinissima al rosso) viene ricolorato con la vividezza
        // del rosso sorgente e appare rosso invece che marrone. La texture
        // sorgente resta usata come moltiplicatore di ombreggiatura relativa
        // (chiaro/scuro), non come valore assoluto.
        const [targetHue, targetSat, targetVal] = rgbToHsv(((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255);

        for (let i = 0; i < data.length; i += 4) {
            const [h, s, v] = rgbToHsv(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);
            const isLivery = h <= LIVERY_HUE_MAX && s >= LIVERY_SAT_MIN;
            const liftedV = liftValue(v);
            const outHue  = isLivery ? targetHue : h;
            const outSat  = isLivery ? targetSat : desaturateForBlack(s);
            const outVal  = isLivery ? targetVal * liftedV : liftedV;
            const [nr, ng, nb] = hsvToRgb(outHue, outSat, outVal);
            data[i]     = Math.round(nr * 255);
            data[i + 1] = Math.round(ng * 255);
            data[i + 2] = Math.round(nb * 255);
        }
        ctx.putImageData(imageData, 0, 0);

        const tex = new THREE.CanvasTexture(canvas);
        tex.flipY     = sourceTexture.flipY;
        tex.wrapS     = sourceTexture.wrapS;
        tex.wrapT     = sourceTexture.wrapT;
        tex.magFilter = sourceTexture.magFilter;
        tex.minFilter = sourceTexture.minFilter;
        tex.encoding  = sourceTexture.encoding;
        tex.needsUpdate = true;
        return tex;
    }

    // loadCarModel: stessa identica implementazione di f1.js (prima
    // dell'estrazione), con UNA sola differenza di firma — scene/listener/
    // engineBuffer arrivano come terzo parametro (deps) invece che per
    // closure su variabili esterne di f1.js. Il loader GLTF viene creato
    // localmente ad ogni chiamata invece di essere condiviso a livello di
    // modulo: in f1.js era una variabile di modulo condivisa tra le
    // chiamate, ma ricrearla qui non cambia il comportamento (il costo è
    // trascurabile).
    function loadCarModel(playerColor, onReady, { scene, listener, engineBuffer }) {
        const loader = new THREE.GLTFLoader();
        loader.load('/assets/custom/f1Car.glb', (gltf) => {
            const group = new THREE.Group();
            const model = gltf.scene;
            model.scale.set(3.5, 3.5, 3.5);

            // Il nodo radice del GLB ha un pivot non centrato sull'asset (translation
            // locale non nulla): senza compensarlo la mesh visibile risulta spostata
            // rispetto al centro logico (group), che è quello usato da fisica, hitbox
            // e camera — causa del disallineamento "auto qui, hitbox là" osservato in
            // gioco. Ricentriamo sul bounding box reale (x/z al centro, y a terra).
            model.updateMatrixWorld(true);
            const carBBox0 = new THREE.Box3().setFromObject(model);
            const carCenter0 = carBBox0.getCenter(new THREE.Vector3());
            model.position.x -= carCenter0.x;
            model.position.z -= carCenter0.z;
            model.position.y -= carBBox0.min.y;

            const hex        = parseInt(playerColor.replace('#', ''), 16);
            const namedWheels = [];
            const allMeshes   = [];

            model.traverse((child) => {
                if (!child.isMesh) return;
                child.castShadow    = true;
                child.receiveShadow = true;
                child.material      = child.material.clone();
                if (child.material.map) {
                    child.material.map = recolorLiveryTexture(child.material.map, hex);
                    child.material.needsUpdate = true;
                } else {
                    const c = child.material.color;
                    if (c.r > 0.85 && c.g > 0.85 && c.b > 0.85) {
                        child.material.color.setHex(hex);
                        child.material.metalness = 0.4;
                        child.material.roughness = 0.35;
                    }
                }
                allMeshes.push(child);
                const nm = (child.name + ' ' + (child.parent?.name || '')).toLowerCase();
                if (nm.includes('wheel') || nm.includes('tyre') || nm.includes('tire')) {
                    namedWheels.push(child);
                }
            });

            console.log('[F1] Mesh nel modello:', allMeshes.map(m => `"${m.name}"`).join(', '));

            group.add(model);

            // Raccogli i nodi PARENT delle ruote (rotazione più corretta del sub-mesh)
            const wheelParentSet = new Set();
            for (const wm of namedWheels) {
                const p = wm.parent;
                if (p && p.isObject3D && !(p.isMesh) && p !== model && p !== gltf.scene) {
                    wheelParentSet.add(p);
                } else {
                    wheelParentSet.add(wm);
                }
            }

            // Fallback bounding-box se non trovate per nome
            let wheels = [...wheelParentSet];
            if (wheels.length < 2 && allMeshes.length > 1) {
                const carBB = new THREE.Box3().setFromObject(group);
                const thresh = carBB.min.y + (carBB.max.y - carBB.min.y) * 0.38;
                wheels = allMeshes.filter(m => {
                    const bb = new THREE.Box3().setFromObject(m);
                    return bb.getCenter(new THREE.Vector3()).y < thresh;
                });
                console.log('[F1] Ruote per BB:', wheels.length);
            }

            // Fallback finale: ruote cilindriche sintetiche — solo se il
            // modello ha più mesh separate (indizio che le ruote ci sono ma
            // non sono state trovate); su una mesh voxel unica (allMeshes.length
            // === 1) le ruote sono già disegnate nel modello stesso, aggiungerne
            // di finte creerebbe cilindri scoordinati sovrapposti.
            if (wheels.length < 2 && allMeshes.length > 1) {
                console.log('[F1] Nessuna ruota separata trovata → aggiungo ruote fake');
                const wGeo = new THREE.CylinderGeometry(0.88, 0.88, 0.65, 16);
                const wMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.95, metalness: 0.1 });
                const wPos = [
                    [-2.7, 0.88,  3.6],   // anteriore sinistra
                    [ 2.7, 0.88,  3.6],   // anteriore destra
                    [-2.7, 0.88, -3.4],   // posteriore sinistra
                    [ 2.7, 0.88, -3.4],   // posteriore destra
                ];
                wheels = [];
                for (const [wx, wy, wz] of wPos) {
                    const w = new THREE.Mesh(wGeo, wMat.clone());
                    w.rotation.z = Math.PI / 2;
                    w.position.set(wx, wy, wz);
                    w.castShadow = true;
                    group.add(w);
                    wheels.push(w);
                }
            }

            group.userData.wheels   = wheels;
            group.userData.wheelRot = 0;

            // Loop motore: un solo buffer, mai fermato — pitch e volume
            // vengono regolati ogni frame in animate() in base a velocità
            // e stato accelerando/decelerando.
            const engineSound = new THREE.PositionalAudio(listener);
            engineSound.setBuffer(engineBuffer);
            engineSound.setLoop(true);
            engineSound.setRefDistance(15);
            engineSound.setRolloffFactor(1.5);
            engineSound.setVolume(0);
            engineSound.play();
            group.add(engineSound);
            group.userData.engineSound = engineSound;

            scene.add(group);
            onReady(group);
        }, undefined, (err) => console.error('Errore car model:', err));
    }

    return { loadCarModel };
});
